import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createProxyHandler } from "../src/proxy.ts";
import { startServer } from "../src/server.ts";
import { BudgetTracker } from "../src/budget.ts";
import { Ledger } from "../src/ledger.ts";
import { createAgentToken, verifyAgentToken } from "../src/identity.ts";
import type { Policy } from "../src/types.ts";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import type { Server } from "bun";

const JWT_SECRET = "integration-test-secret";

let mockUpstream: Server;
let kyaServer: Server;
let ledger: Ledger;
let budget: BudgetTracker;
const dbPath = join(tmpdir(), `kya-integration-test-${Date.now()}.sqlite`);

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
];

beforeAll(() => {
  mockUpstream = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          result: { content: [{ type: "text", text: "ok" }] },
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
    jwtSecret: JWT_SECRET,
  });

  kyaServer = startServer({
    port: 0,
    host: "localhost",
    proxyHandler,
    budget,
    ledger,
    jwtSecret: JWT_SECRET,
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

describe("Integration — JWT auth in proxy", () => {
  test("request with valid JWT identifies agent correctly", async () => {
    const token = await createAgentToken({ agentId: "jwt-test-agent", owner: "tester" }, JWT_SECRET);
    const res = await fetch(`${kyaUrl()}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Session-Id": "int-jwt-s1",
        "X-Tool-Cost": "15",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "web_search", arguments: {} },
        id: 1,
      }),
    });
    const body = await res.json();
    expect(body.result).toBeDefined();

    const session = budget.getSession("int-jwt-s1");
    expect(session).toBeDefined();
    expect(session!.agentId).toBe("jwt-test-agent");
  });

  test("request with invalid JWT falls back to X-Agent-Id", async () => {
    const res = await fetch(`${kyaUrl()}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid.jwt.here",
        "X-Agent-Id": "fallback-agent",
        "X-Session-Id": "int-fallback-s1",
        "X-Tool-Cost": "10",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "web_search", arguments: {} },
        id: 1,
      }),
    });
    const body = await res.json();
    expect(body.result).toBeDefined();

    const session = budget.getSession("int-fallback-s1");
    expect(session).toBeDefined();
    expect(session!.agentId).toBe("fallback-agent");
  });

  test("request with no auth headers falls back to anonymous", async () => {
    const res = await fetch(`${kyaUrl()}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": "int-anon-s1",
        "X-Tool-Cost": "5",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "web_search", arguments: {} },
        id: 1,
      }),
    });
    const body = await res.json();
    expect(body.result).toBeDefined();

    const session = budget.getSession("int-anon-s1");
    expect(session).toBeDefined();
    expect(session!.agentId).toBe("anonymous");
  });
});

describe("Integration — Dashboard routes", () => {
  test("GET /dashboard returns HTML", async () => {
    const res = await fetch(`${kyaUrl()}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("KYA");
    expect(html).toContain("<!DOCTYPE html>");
  });

  test("GET / redirects to /dashboard", async () => {
    const res = await fetch(`${kyaUrl()}/`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
  });

  test("GET /api/dashboard returns JSON", async () => {
    const res = await fetch(`${kyaUrl()}/api/dashboard`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = await res.json();
    expect(typeof body.totalSpentCents).toBe("number");
    expect(typeof body.totalCalls).toBe("number");
    expect(typeof body.blockedCalls).toBe("number");
    expect(typeof body.activeSessions).toBe("number");
    expect(Array.isArray(body.agentBreakdown)).toBe(true);
    expect(Array.isArray(body.recentCalls)).toBe(true);
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  test("GET /api/agents returns agent list", async () => {
    const res = await fetch(`${kyaUrl()}/api/agents`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe("Integration — Token endpoint", () => {
  test("POST /api/tokens creates a valid JWT", async () => {
    const res = await fetch(`${kyaUrl()}/api/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "new-agent", owner: "admin" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe("string");

    // Verify the token is valid
    const decoded = await verifyAgentToken(body.token, JWT_SECRET);
    expect(decoded.agentId).toBe("new-agent");
    expect(decoded.owner).toBe("admin");
  });

  test("POST /api/tokens rejects missing fields", async () => {
    const res = await fetch(`${kyaUrl()}/api/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "no-owner" }),
    });
    expect(res.status).toBe(400);
  });
});
