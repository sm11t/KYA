import type { Policy } from "./types.ts";
import type { BudgetTracker } from "./budget.ts";
import type { Ledger } from "./ledger.ts";
import { findPolicy, checkPolicy } from "./policy.ts";

interface ProxyDeps {
  upstreamUrl: string;
  policies: Policy[];
  budget: BudgetTracker;
  ledger: Ledger;
}

export function createProxyHandler(deps: ProxyDeps): (req: Request) => Promise<Response> {
  const { upstreamUrl, policies, budget, ledger } = deps;

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
      const agentId = req.headers.get("X-Agent-Id") || "anonymous";
      const sessionId = req.headers.get("X-Session-Id") || crypto.randomUUID();
      const costCents = parseInt(req.headers.get("X-Tool-Cost") || "0", 10);

      const session = budget.getOrCreateSession(sessionId, agentId);
      const policy = findPolicy(policies, agentId);
      const check = checkPolicy(policy, toolName, costCents, session);

      if (!check.allowed) {
        ledger.logCall({
          sessionId,
          agentId,
          toolName,
          costCents,
          timestamp: Date.now(),
          blocked: true,
          reason: check.reason || "Policy violation",
          upstreamDurationMs: 0,
        });

        return jsonRpcError(id, -32001, check.reason || "Blocked by policy");
      }

      const start = performance.now();
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
      const durationMs = Math.round(performance.now() - start);

      budget.recordSpend(sessionId, toolName, costCents);

      ledger.logCall({
        sessionId,
        agentId,
        toolName,
        costCents,
        timestamp: Date.now(),
        blocked: false,
        reason: null,
        upstreamDurationMs: durationMs,
      });

      const alerts = budget.checkAlerts(sessionId, policy);
      if (alerts.length > 0) {
        console.log(
          `[KYA] Budget alert for session ${sessionId}: crossed thresholds ${alerts.map((a) => `${a * 100}%`).join(", ")}`,
        );
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
