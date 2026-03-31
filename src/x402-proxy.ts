import type { Policy } from "./types.ts";
import type { BudgetTracker } from "./budget.ts";
import type { Ledger } from "./ledger.ts";
import type { WalletManager } from "./wallet.ts";
import { findPolicy, checkPolicy } from "./policy.ts";
import { extractAgentId } from "./identity.ts";
import { parseX402Challenge, createPaymentReceipt, attachPaymentProof } from "./x402.ts";

interface X402ProxyDeps {
  upstreamUrl: string;
  policies: Policy[];
  budget: BudgetTracker;
  ledger: Ledger;
  walletManager: WalletManager;
  jwtSecret?: string;
}

export function createX402ProxyHandler(deps: X402ProxyDeps): (req: Request) => Promise<Response> {
  const { upstreamUrl, policies, budget, ledger, walletManager } = deps;

  return async (req: Request): Promise<Response> => {
    let body: { jsonrpc: string; method: string; params?: Record<string, unknown>; id?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonRpcError(null, -32700, "Parse error");
    }

    const { method, params, id } = body;

    if (method === "tools/call") {
      const toolName = (params?.name as string) || "unknown";
      const agentId = await extractAgentId(req, deps.jwtSecret || "");
      const sessionId = req.headers.get("X-Session-Id") || crypto.randomUUID();
      const costCents = parseInt(req.headers.get("X-Tool-Cost") || "0", 10);

      const session = budget.getOrCreateSession(sessionId, agentId);
      const policy = findPolicy(policies, agentId);
      const check = checkPolicy(policy, toolName, costCents, session);

      if (!check.allowed) {
        ledger.logCall({
          sessionId, agentId, toolName, costCents,
          timestamp: Date.now(), blocked: true,
          reason: check.reason || "Policy violation",
          upstreamDurationMs: 0,
        });
        return jsonRpcError(id, -32001, check.reason || "Blocked by policy");
      }

      // Reserve budget BEFORE the upstream call
      budget.recordSpend(sessionId, toolName, costCents);

      const start = performance.now();
      let upstreamResponse: Response;
      try {
        upstreamResponse = await fetch(upstreamUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        budget.refundSpend(sessionId, toolName, costCents);
        return jsonRpcError(id, -32603, `Upstream error: ${err}`);
      }

      // Check for x402 payment required
      if (upstreamResponse.status === 402) {
        // Refund the initial budget reservation — actual cost comes from x402 challenge
        budget.refundSpend(sessionId, toolName, costCents);

        const challenge = parseX402Challenge(upstreamResponse);
        if (!challenge) {
          ledger.logCall({
            sessionId, agentId, toolName, costCents: 0,
            timestamp: Date.now(), blocked: true,
            reason: "Received 402 but could not parse x402 challenge",
            upstreamDurationMs: Math.round(performance.now() - start),
          });
          return jsonRpcError(id, -32001, "Received 402 but could not parse x402 challenge");
        }

        const x402Cost = challenge.price;

        // Re-check policy with the x402 price
        const x402Check = checkPolicy(policy, toolName, x402Cost, session);
        if (!x402Check.allowed) {
          ledger.logCall({
            sessionId, agentId, toolName, costCents: x402Cost,
            timestamp: Date.now(), blocked: true,
            reason: `x402 payment blocked: ${x402Check.reason}`,
            upstreamDurationMs: Math.round(performance.now() - start),
          });
          return jsonRpcError(id, -32001, `x402 payment blocked: ${x402Check.reason}`);
        }

        // Check wallet balance
        const wallet = walletManager.getWallet(agentId);
        if (!wallet) {
          ledger.logCall({
            sessionId, agentId, toolName, costCents: x402Cost,
            timestamp: Date.now(), blocked: true,
            reason: "No wallet found for agent",
            upstreamDurationMs: Math.round(performance.now() - start),
          });
          return jsonRpcError(id, -32001, "No wallet found for agent");
        }

        const debitResult = walletManager.debit(agentId, x402Cost, `x402 payment for ${toolName}`);
        if (!debitResult.success) {
          ledger.logCall({
            sessionId, agentId, toolName, costCents: x402Cost,
            timestamp: Date.now(), blocked: true,
            reason: `Wallet debit failed: ${debitResult.reason}`,
            upstreamDurationMs: Math.round(performance.now() - start),
          });
          return jsonRpcError(id, -32001, `Wallet debit failed: ${debitResult.reason}`);
        }

        // Reserve the x402 cost in the budget tracker
        budget.recordSpend(sessionId, toolName, x402Cost);

        // Create payment receipt and retry
        const receipt = createPaymentReceipt(challenge, wallet);
        const retryRequest = new Request(upstreamUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Payment-TxHash": receipt.txHash,
            "X-Payment-Payer": receipt.payer,
            "X-Payment-Amount": String(receipt.amount),
            "X-Payment-Currency": receipt.currency,
            "X-Payment-Timestamp": String(receipt.timestamp),
          },
          body: JSON.stringify(body),
        });

        let retryResponse: Response;
        try {
          retryResponse = await fetch(retryRequest);
        } catch (err) {
          budget.refundSpend(sessionId, toolName, x402Cost);
          // Note: wallet already debited — in production you'd handle refunds
          return jsonRpcError(id, -32603, `Upstream error on x402 retry: ${err}`);
        }
        const totalDuration = Math.round(performance.now() - start);

        ledger.logCall({
          sessionId, agentId, toolName, costCents: x402Cost,
          timestamp: Date.now(), blocked: false, reason: null,
          upstreamDurationMs: totalDuration,
        });

        const alerts = budget.checkAlerts(sessionId, policy);
        if (alerts.length > 0) {
          console.log(`[KYA] Budget alert for session ${sessionId}: crossed thresholds ${alerts.map((a) => `${a * 100}%`).join(", ")}`);
        }

        const retryBody = await retryResponse.text();
        return new Response(retryBody, {
          status: retryResponse.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Non-402 response — normal flow
      const durationMs = Math.round(performance.now() - start);

      ledger.logCall({
        sessionId, agentId, toolName, costCents,
        timestamp: Date.now(), blocked: false, reason: null,
        upstreamDurationMs: durationMs,
      });

      const alerts = budget.checkAlerts(sessionId, policy);
      if (alerts.length > 0) {
        console.log(`[KYA] Budget alert for session ${sessionId}: crossed thresholds ${alerts.map((a) => `${a * 100}%`).join(", ")}`);
      }

      const responseBody = await upstreamResponse.text();
      return new Response(responseBody, {
        status: upstreamResponse.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // For tools/list and other methods, forward transparently
    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return jsonRpcError(id, -32603, `Upstream error: ${err}`);
    }

    const responseBody = await upstreamResponse.text();
    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function jsonRpcError(id: unknown, code: number, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: id ?? null,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
