import { describe, test, expect } from "bun:test";
import { loadPolicies, findPolicy, checkPolicy } from "../src/policy.ts";
import type { Policy, SessionState } from "../src/types.ts";
import { join } from "path";

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: "test-session",
    agentId: "test-agent",
    totalSpentCents: 0,
    callCount: 0,
    startedAt: Date.now(),
    toolSpend: {},
    recentCallTimestamps: [],
    ...overrides,
  };
}

const basePolicy: Policy = {
  agent: "test",
  sessionBudget: 1000,
  perCallMax: 100,
  allowedTools: [],
  blockedTools: [],
  rateLimit: { maxCallsPerMinute: 60 },
  alertThresholds: [0.5, 0.8, 0.95],
};

describe("checkPolicy", () => {
  test("allows call when no restrictions", () => {
    const result = checkPolicy(basePolicy, "any_tool", 10, makeSession());
    expect(result.allowed).toBe(true);
  });

  test("blocks tool on blocklist", () => {
    const policy = { ...basePolicy, blockedTools: ["send_email"] };
    const result = checkPolicy(policy, "send_email", 10, makeSession());
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("blocked");
  });

  test("allows tool not on blocklist", () => {
    const policy = { ...basePolicy, blockedTools: ["send_email"] };
    const result = checkPolicy(policy, "web_search", 10, makeSession());
    expect(result.allowed).toBe(true);
  });

  test("allows tool on allowlist", () => {
    const policy = { ...basePolicy, allowedTools: ["web_search", "code_review"] };
    const result = checkPolicy(policy, "web_search", 10, makeSession());
    expect(result.allowed).toBe(true);
  });

  test("blocks tool not on allowlist when allowlist is non-empty", () => {
    const policy = { ...basePolicy, allowedTools: ["web_search"] };
    const result = checkPolicy(policy, "send_email", 10, makeSession());
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not in the allowed list");
  });

  test("empty allowlist means all tools allowed", () => {
    const policy = { ...basePolicy, allowedTools: [] };
    const result = checkPolicy(policy, "anything", 10, makeSession());
    expect(result.allowed).toBe(true);
  });

  test("blocks call exceeding perCallMax", () => {
    const result = checkPolicy(basePolicy, "expensive_tool", 200, makeSession());
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("per-call max");
  });

  test("blocks call that would exceed session budget", () => {
    const session = makeSession({ totalSpentCents: 950 });
    const result = checkPolicy(basePolicy, "tool", 60, session);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("session budget");
  });

  test("allows call within session budget", () => {
    const session = makeSession({ totalSpentCents: 900 });
    const result = checkPolicy(basePolicy, "tool", 100, session);
    expect(result.allowed).toBe(true);
  });

  test("blocks when rate limit exceeded", () => {
    const now = Date.now();
    const timestamps = Array.from({ length: 60 }, (_, i) => now - i * 500);
    const session = makeSession({ recentCallTimestamps: timestamps });
    const result = checkPolicy(basePolicy, "tool", 10, session);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Rate limit");
  });

  test("allows when old timestamps are outside window", () => {
    const now = Date.now();
    const timestamps = Array.from({ length: 60 }, () => now - 120_000);
    const session = makeSession({ recentCallTimestamps: timestamps });
    const result = checkPolicy(basePolicy, "tool", 10, session);
    expect(result.allowed).toBe(true);
  });
});

describe("loadPolicies", () => {
  test("loads policies from directory", () => {
    const policies = loadPolicies(join(import.meta.dir, "../policies"));
    expect(policies.length).toBeGreaterThanOrEqual(2);
    expect(policies.find((p) => p.agent === "default")).toBeTruthy();
  });

  test("returns empty array for missing directory", () => {
    const policies = loadPolicies("/nonexistent/path");
    expect(policies).toEqual([]);
  });
});

describe("findPolicy", () => {
  const policies: Policy[] = [
    { ...basePolicy, agent: "default", sessionBudget: 1000 },
    { ...basePolicy, agent: "coding-agent", sessionBudget: 500 },
  ];

  test("finds exact match", () => {
    const policy = findPolicy(policies, "coding-agent");
    expect(policy.agent).toBe("coding-agent");
    expect(policy.sessionBudget).toBe(500);
  });

  test("falls back to default policy", () => {
    const policy = findPolicy(policies, "unknown-agent");
    expect(policy.agent).toBe("default");
  });

  test("falls back to built-in default when no default policy", () => {
    const policy = findPolicy([{ ...basePolicy, agent: "specific" }], "unknown");
    expect(policy.agent).toBe("default");
    expect(policy.sessionBudget).toBe(10000);
  });
});
