import { describe, test, expect } from "bun:test";
import { BudgetTracker } from "../src/budget.ts";
import type { Policy } from "../src/types.ts";

const policy: Policy = {
  agent: "test",
  sessionBudget: 1000,
  perCallMax: 100,
  allowedTools: [],
  blockedTools: [],
  rateLimit: { maxCallsPerMinute: 60 },
  alertThresholds: [0.5, 0.8, 0.95],
};

describe("BudgetTracker", () => {
  test("creates and retrieves sessions", () => {
    const tracker = new BudgetTracker();
    const session = tracker.startSession("s1", "agent-a");
    expect(session.sessionId).toBe("s1");
    expect(session.agentId).toBe("agent-a");
    expect(session.totalSpentCents).toBe(0);

    const retrieved = tracker.getSession("s1");
    expect(retrieved).toBeDefined();
    expect(retrieved!.sessionId).toBe("s1");
  });

  test("returns undefined for unknown session", () => {
    const tracker = new BudgetTracker();
    expect(tracker.getSession("nonexistent")).toBeUndefined();
  });

  test("getOrCreateSession creates if missing", () => {
    const tracker = new BudgetTracker();
    const session = tracker.getOrCreateSession("s1", "agent-a");
    expect(session.sessionId).toBe("s1");

    const same = tracker.getOrCreateSession("s1", "agent-a");
    expect(same).toBe(session);
  });

  test("records spend and updates totals", () => {
    const tracker = new BudgetTracker();
    tracker.startSession("s1", "agent-a");

    tracker.recordSpend("s1", "web_search", 25);
    tracker.recordSpend("s1", "code_review", 50);
    tracker.recordSpend("s1", "web_search", 10);

    const session = tracker.getSession("s1")!;
    expect(session.totalSpentCents).toBe(85);
    expect(session.callCount).toBe(3);
  });

  test("tracks per-tool breakdown", () => {
    const tracker = new BudgetTracker();
    tracker.startSession("s1", "agent-a");

    tracker.recordSpend("s1", "web_search", 25);
    tracker.recordSpend("s1", "code_review", 50);
    tracker.recordSpend("s1", "web_search", 10);

    const session = tracker.getSession("s1")!;
    expect(session.toolSpend["web_search"]).toBe(35);
    expect(session.toolSpend["code_review"]).toBe(50);
  });

  test("detects crossed alert thresholds", () => {
    const tracker = new BudgetTracker();
    tracker.startSession("s1", "agent-a");
    tracker.recordSpend("s1", "tool", 600);

    const alerts = tracker.checkAlerts("s1", policy);
    expect(alerts).toContain(0.5);
    expect(alerts).not.toContain(0.8);
  });

  test("detects multiple crossed thresholds", () => {
    const tracker = new BudgetTracker();
    tracker.startSession("s1", "agent-a");
    tracker.recordSpend("s1", "tool", 960);

    const alerts = tracker.checkAlerts("s1", policy);
    expect(alerts).toContain(0.5);
    expect(alerts).toContain(0.8);
    expect(alerts).toContain(0.95);
  });

  test("no alerts when under first threshold", () => {
    const tracker = new BudgetTracker();
    tracker.startSession("s1", "agent-a");
    tracker.recordSpend("s1", "tool", 100);

    const alerts = tracker.checkAlerts("s1", policy);
    expect(alerts).toHaveLength(0);
  });

  test("returns empty alerts for unknown session", () => {
    const tracker = new BudgetTracker();
    const alerts = tracker.checkAlerts("nonexistent", policy);
    expect(alerts).toEqual([]);
  });
});
