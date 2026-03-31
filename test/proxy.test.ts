import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createProxyHandler } from "../src/proxy.ts";
import { startServer } from "../src/server.ts";
import { BudgetTracker } from "../src/budget.ts";
import { Ledger } from "../src/ledger.ts";
import { loadPolicies } from "../src/policy.ts";
import type { Policy } from "../src/types.ts";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import type { Server } from "bun";

let mockUpstream: Server;
let kyaServer: Server;
let ledger: Ledger;
let budget: BudgetTracker;
const dbPath = join(tmpdir(), `kya-proxy-test-${Date.now()}.sqlite`);

const policies: Policy[] = [
  {
    agent: "default",
    sessionBudget: 1000,
    perCallMax: 100,
    allowedTools: [],
    blockedTools: [],
    rateLimit: { maxCallsPerMinute: 60 },
    alertThresholds: [0.5, 0.8, 0.95],
  },
  {
    agent: "restricted-agent",
    sessionBudget: 200,
    perCallMax: 50,
    allowedTools: ["web_search"],
    blockedTools: ["send_email"],
    rateLimit: { maxCallsPerMinute: 5 },
    alertThresholds: [0.5, 0.8, 0.95],
  },
];

beforeAll(() => {
  // Mock upstream MCP server
  mockUpstream = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          result: { content: [{ type: "text", text: "upstream response" }] },
          id: 1,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  });

  ledger = new Ledger(dbPath);
  budget = new BudgetTracker();

  const proxyHandler = createProxyHandler({
    upstreamUrl: `http://localhost:${mockUpstream.port}`,
    policies,
    budget,
    ledger,
  });

  kyaServer = startServer({
    port: 0,
    host: "localhost",
    proxyHandler,
    budget,
    ledger,
  });
});

afterAll(() => {
  mockUpstream.stop();
  kyaServer.stop();
  ledger.close();
  try {
    unlinkSync(dbPath);
    unlinkSync(dbPath + "-wal");
    unlinkSync(dbPath + "-shm");
  } catch {}
});

const kyaUrl = () => `http://localhost:${kyaServer.port}`;

function mcpRequest(method: string, params?: Record<string, unknown>, headers?: Record<string, string>) {
  return fetch(`${kyaUrl()}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
}

describe("Proxy — tools/list forwarding", () => {
  test("forwards tools/list to upstream", async () => {
    const res = await mcpRequest("tools/list");
    const body = await res.json();
    expect(body.result).toBeDefined();
  });
});

describe("Proxy — tools/call", () => {
  test("forwards allowed call and logs it", async () => {
    const res = await mcpRequest(
      "tools/call",
      { name: "web_search", arguments: { q: "test" } },
      { "X-Agent-Id": "default-agent", "X-Session-Id": "proxy-s1", "X-Tool-Cost": "25" },
    );
    const body = await res.json();
    expect(body.result).toBeDefined();

    const session = budget.getSession("proxy-s1");
    expect(session).toBeDefined();
    expect(session!.totalSpentCents).toBe(25);
  });

  test("blocks tool on blocklist", async () => {
    const res = await mcpRequest(
      "tools/call",
      { name: "send_email", arguments: {} },
      { "X-Agent-Id": "restricted-agent", "X-Session-Id": "proxy-s2", "X-Tool-Cost": "5" },
    );
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("blocked");
  });

  test("blocks tool not on allowlist", async () => {
    const res = await mcpRequest(
      "tools/call",
      { name: "code_review", arguments: {} },
      { "X-Agent-Id": "restricted-agent", "X-Session-Id": "proxy-s3", "X-Tool-Cost": "5" },
    );
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("not in the allowed list");
  });

  test("blocks call exceeding budget", async () => {
    // Create a session near the limit
    const sid = "proxy-budget-test";
    const session = budget.getOrCreateSession(sid, "restricted-agent");
    session.totalSpentCents = 180;

    const res = await mcpRequest(
      "tools/call",
      { name: "web_search", arguments: {} },
      { "X-Agent-Id": "restricted-agent", "X-Session-Id": sid, "X-Tool-Cost": "30" },
    );
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("session budget");
  });

  test("blocks when rate limited", async () => {
    const sid = "proxy-rate-test";
    const session = budget.getOrCreateSession(sid, "restricted-agent");
    const now = Date.now();
    session.recentCallTimestamps = Array.from({ length: 5 }, (_, i) => now - i * 1000);

    const res = await mcpRequest(
      "tools/call",
      { name: "web_search", arguments: {} },
      { "X-Agent-Id": "restricted-agent", "X-Session-Id": sid, "X-Tool-Cost": "5" },
    );
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("Rate limit");
  });
});

describe("HTTP endpoints", () => {
  test("GET /health returns ok", async () => {
    const res = await fetch(`${kyaUrl()}/health`);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
  });

  test("GET /status returns stats", async () => {
    const res = await fetch(`${kyaUrl()}/status`);
    const body = await res.json();
    expect(typeof body.activeSessions).toBe("number");
    expect(typeof body.totalSpentCents).toBe("number");
    expect(Array.isArray(body.recentCalls)).toBe(true);
  });

  test("GET /sessions/:id returns session", async () => {
    const res = await fetch(`${kyaUrl()}/sessions/proxy-s1`);
    const body = await res.json();
    expect(body.session).toBeDefined();
    expect(body.session.sessionId).toBe("proxy-s1");
    expect(Array.isArray(body.calls)).toBe(true);
  });

  test("GET /sessions/:id returns 404 for unknown", async () => {
    const res = await fetch(`${kyaUrl()}/sessions/nonexistent`);
    expect(res.status).toBe(404);
  });

  test("CORS headers are present", async () => {
    const res = await fetch(`${kyaUrl()}/health`);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
