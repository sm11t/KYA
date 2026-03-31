import { describe, test, expect } from "bun:test";
import { createAgentToken, verifyAgentToken, extractAgentId } from "../src/identity.ts";

const SECRET = "test-secret-key-for-jwt";

describe("Identity — JWT tokens", () => {
  test("creates and verifies a token", async () => {
    const token = await createAgentToken({ agentId: "agent-1", owner: "alice" }, SECRET);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);

    const decoded = await verifyAgentToken(token, SECRET);
    expect(decoded.agentId).toBe("agent-1");
    expect(decoded.owner).toBe("alice");
  });

  test("verifies token with permissions", async () => {
    const token = await createAgentToken(
      { agentId: "agent-2", owner: "bob", permissions: ["read", "write"] },
      SECRET,
    );
    const decoded = await verifyAgentToken(token, SECRET);
    expect(decoded.agentId).toBe("agent-2");
    expect(decoded.owner).toBe("bob");
    expect(decoded.permissions).toEqual(["read", "write"]);
  });

  test("expired token fails verification", async () => {
    const token = await createAgentToken({ agentId: "agent-3", owner: "carol" }, SECRET, "0s");
    // Wait a tick for expiration
    await new Promise((r) => setTimeout(r, 1100));
    await expect(verifyAgentToken(token, SECRET)).rejects.toThrow();
  });

  test("invalid token fails verification", async () => {
    await expect(verifyAgentToken("not.a.valid.token", SECRET)).rejects.toThrow();
  });

  test("token with wrong secret fails verification", async () => {
    const token = await createAgentToken({ agentId: "agent-4", owner: "dave" }, SECRET);
    await expect(verifyAgentToken(token, "wrong-secret")).rejects.toThrow();
  });
});

describe("Identity — extractAgentId", () => {
  test("picks agentId from JWT Authorization header", async () => {
    const token = await createAgentToken({ agentId: "jwt-agent", owner: "test" }, SECRET);
    const req = new Request("http://localhost/mcp", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const agentId = await extractAgentId(req, SECRET);
    expect(agentId).toBe("jwt-agent");
  });

  test("falls back to X-Agent-Id header", async () => {
    const req = new Request("http://localhost/mcp", {
      headers: { "X-Agent-Id": "header-agent" },
    });
    const agentId = await extractAgentId(req, SECRET);
    expect(agentId).toBe("header-agent");
  });

  test("falls back to anonymous", async () => {
    const req = new Request("http://localhost/mcp");
    const agentId = await extractAgentId(req, SECRET);
    expect(agentId).toBe("anonymous");
  });

  test("falls back to X-Agent-Id on invalid JWT", async () => {
    const req = new Request("http://localhost/mcp", {
      headers: {
        Authorization: "Bearer invalid.jwt.token",
        "X-Agent-Id": "fallback-agent",
      },
    });
    const agentId = await extractAgentId(req, SECRET);
    expect(agentId).toBe("fallback-agent");
  });
});
