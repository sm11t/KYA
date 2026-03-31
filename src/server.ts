import type { BudgetTracker } from "./budget.ts";
import type { Ledger } from "./ledger.ts";
import type { WalletManager } from "./wallet.ts";
import { getDashboardData } from "./dashboard-data.ts";
import { renderDashboard } from "./dashboard.ts";
import { createAgentToken } from "./identity.ts";

interface ServerDeps {
  port: number;
  host: string;
  proxyHandler: (req: Request) => Promise<Response>;
  budget: BudgetTracker;
  ledger: Ledger;
  jwtSecret?: string;
  walletManager?: WalletManager;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agent-Id, X-Session-Id, X-Tool-Cost",
};

function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

function jsonResponse(data: unknown, status = 200): Response {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

export function startServer(deps: ServerDeps) {
  const { port, host, proxyHandler, budget, ledger, walletManager } = deps;

  const server = Bun.serve({
    port,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
      }

      // Dashboard routes
      if (req.method === "GET" && url.pathname === "/") {
        return withCors(
          new Response(null, { status: 302, headers: { Location: "/dashboard" } }),
        );
      }

      if (req.method === "GET" && url.pathname === "/dashboard") {
        const data = getDashboardData(budget, ledger, walletManager);
        const html = renderDashboard(data);
        return withCors(
          new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }),
        );
      }

      if (req.method === "GET" && url.pathname === "/api/dashboard") {
        const data = getDashboardData(budget, ledger, walletManager);
        return jsonResponse(data);
      }

      if (req.method === "GET" && url.pathname === "/api/agents") {
        const breakdown = ledger.getAgentBreakdown();
        return jsonResponse(breakdown);
      }

      const agentMatch = url.pathname.match(/^\/api\/agents\/(.+)$/);
      if (req.method === "GET" && agentMatch) {
        const agentId = decodeURIComponent(agentMatch[1]);
        const breakdown = ledger.getAgentBreakdown().find((a) => a.agentId === agentId);
        const calls = ledger.getAgentCalls(agentId);
        const sessions = budget.getActiveSessions().filter((s) => s.agentId === agentId);
        return jsonResponse({ agent: breakdown || null, calls, sessions });
      }

      if (req.method === "POST" && url.pathname === "/api/tokens") {
        try {
          const body = await req.json();
          const { agentId, owner, permissions } = body;
          if (!agentId || !owner) {
            return jsonResponse({ error: "agentId and owner are required" }, 400);
          }
          const secret = deps.jwtSecret || "change-me-to-a-random-secret";
          const token = await createAgentToken({ agentId, owner, permissions }, secret);
          return jsonResponse({ token });
        } catch {
          return jsonResponse({ error: "Invalid request body" }, 400);
        }
      }

      // Wallet routes
      if (req.method === "GET" && url.pathname === "/api/wallets") {
        if (!walletManager) return jsonResponse({ error: "Wallet manager not configured" }, 501);
        return jsonResponse(walletManager.listWallets());
      }

      const walletAgentMatch = url.pathname.match(/^\/api\/wallets\/([^/]+)\/transactions$/);
      if (req.method === "GET" && walletAgentMatch) {
        if (!walletManager) return jsonResponse({ error: "Wallet manager not configured" }, 501);
        const agentId = decodeURIComponent(walletAgentMatch[1]);
        return jsonResponse(walletManager.getTransactions(agentId));
      }

      const walletCreditMatch = url.pathname.match(/^\/api\/wallets\/([^/]+)\/credit$/);
      if (req.method === "POST" && walletCreditMatch) {
        if (!walletManager) return jsonResponse({ error: "Wallet manager not configured" }, 501);
        try {
          const body = await req.json();
          const agentId = decodeURIComponent(walletCreditMatch[1]);
          const amount = body.amount;
          if (typeof amount !== "number" || amount <= 0) {
            return jsonResponse({ error: "amount must be a positive number (in cents)" }, 400);
          }
          const newBalance = walletManager.credit(agentId, amount);
          return jsonResponse({ agentId, newBalance });
        } catch {
          return jsonResponse({ error: "Invalid request body" }, 400);
        }
      }

      const walletGetMatch = url.pathname.match(/^\/api\/wallets\/([^/]+)$/);
      if (req.method === "GET" && walletGetMatch) {
        if (!walletManager) return jsonResponse({ error: "Wallet manager not configured" }, 501);
        const agentId = decodeURIComponent(walletGetMatch[1]);
        const wallet = walletManager.getWallet(agentId);
        if (!wallet) return jsonResponse({ error: "Wallet not found" }, 404);
        return jsonResponse(wallet);
      }

      if (req.method === "POST" && url.pathname === "/api/wallets") {
        if (!walletManager) return jsonResponse({ error: "Wallet manager not configured" }, 501);
        try {
          const body = await req.json();
          const { agentId, initialBalance } = body;
          if (!agentId || typeof initialBalance !== "number" || initialBalance < 0) {
            return jsonResponse({ error: "agentId and initialBalance (in cents) are required" }, 400);
          }
          const wallet = walletManager.createWallet(agentId, initialBalance);
          return jsonResponse(wallet, 201);
        } catch {
          return jsonResponse({ error: "Invalid request body" }, 400);
        }
      }

      if (req.method === "POST" && url.pathname === "/mcp") {
        const response = await proxyHandler(req);
        return withCors(response);
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ status: "ok", version: "0.1.0" });
      }

      if (req.method === "GET" && url.pathname === "/status") {
        const sessions = budget.getActiveSessions();
        const totalSpentCents = sessions.reduce((sum, s) => sum + s.totalSpentCents, 0);
        const recentCalls = ledger.getRecentCalls(10);
        return jsonResponse({
          activeSessions: sessions.length,
          totalSpentCents,
          recentCalls,
        });
      }

      const sessionMatch = url.pathname.match(/^\/sessions\/(.+)$/);
      if (req.method === "GET" && sessionMatch) {
        const sessionId = sessionMatch[1];
        const session = budget.getSession(sessionId);
        if (!session) {
          return jsonResponse({ error: "Session not found" }, 404);
        }
        const calls = ledger.getSessionCalls(sessionId);
        return jsonResponse({ session, calls });
      }

      return jsonResponse({ error: "Not found" }, 404);
    },
  });

  return server;
}
