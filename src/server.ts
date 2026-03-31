import type { BudgetTracker } from "./budget.ts";
import type { Ledger } from "./ledger.ts";

interface ServerDeps {
  port: number;
  host: string;
  proxyHandler: (req: Request) => Promise<Response>;
  budget: BudgetTracker;
  ledger: Ledger;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Agent-Id, X-Session-Id, X-Tool-Cost",
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
  const { port, host, proxyHandler, budget, ledger } = deps;

  const server = Bun.serve({
    port,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
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
