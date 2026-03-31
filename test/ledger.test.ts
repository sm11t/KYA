import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Ledger } from "../src/ledger.ts";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

let ledger: Ledger;
const dbPath = join(tmpdir(), `kya-test-${Date.now()}.sqlite`);

beforeAll(() => {
  ledger = new Ledger(dbPath);
});

afterAll(() => {
  ledger.close();
  try {
    unlinkSync(dbPath);
    unlinkSync(dbPath + "-wal");
    unlinkSync(dbPath + "-shm");
  } catch {}
});

describe("Ledger", () => {
  test("logs and retrieves calls", () => {
    ledger.logCall({
      sessionId: "s1",
      agentId: "agent-a",
      toolName: "web_search",
      costCents: 25,
      timestamp: 1000,
      blocked: false,
      reason: null,
      upstreamDurationMs: 150,
    });

    const calls = ledger.getSessionCalls("s1");
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe("web_search");
    expect(calls[0].costCents).toBe(25);
    expect(calls[0].blocked).toBe(false);
    expect(calls[0].upstreamDurationMs).toBe(150);
  });

  test("logs blocked calls with reason", () => {
    ledger.logCall({
      sessionId: "s1",
      agentId: "agent-a",
      toolName: "send_email",
      costCents: 10,
      timestamp: 2000,
      blocked: true,
      reason: "Tool is blocked",
      upstreamDurationMs: 0,
    });

    const calls = ledger.getSessionCalls("s1");
    const blocked = calls.find((c) => c.blocked);
    expect(blocked).toBeDefined();
    expect(blocked!.reason).toBe("Tool is blocked");
    expect(blocked!.toolName).toBe("send_email");
  });

  test("filters by session", () => {
    ledger.logCall({
      sessionId: "s2",
      agentId: "agent-b",
      toolName: "code_review",
      costCents: 50,
      timestamp: 3000,
      blocked: false,
      reason: null,
      upstreamDurationMs: 200,
    });

    const s1Calls = ledger.getSessionCalls("s1");
    const s2Calls = ledger.getSessionCalls("s2");
    expect(s1Calls).toHaveLength(2);
    expect(s2Calls).toHaveLength(1);
    expect(s2Calls[0].agentId).toBe("agent-b");
  });

  test("calculates total spend (excludes blocked)", () => {
    const total = ledger.getTotalSpend();
    expect(total).toBe(75); // 25 + 50, excluding blocked call
  });

  test("calculates total spend filtered by agent", () => {
    const total = ledger.getTotalSpend("agent-a");
    expect(total).toBe(25);
  });

  test("calculates total spend filtered by time", () => {
    const total = ledger.getTotalSpend(undefined, 2500);
    expect(total).toBe(50); // only the s2 call at timestamp 3000
  });

  test("retrieves recent calls", () => {
    const recent = ledger.getRecentCalls(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].timestamp).toBeGreaterThanOrEqual(recent[1].timestamp);
  });
});
