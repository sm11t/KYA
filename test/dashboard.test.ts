import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { renderDashboard } from "../src/dashboard.ts";
import { getDashboardData } from "../src/dashboard-data.ts";
import { BudgetTracker } from "../src/budget.ts";
import { Ledger } from "../src/ledger.ts";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

const dbPath = join(tmpdir(), `kya-dashboard-test-${Date.now()}.sqlite`);
let ledger: Ledger;
let budget: BudgetTracker;

beforeAll(() => {
  ledger = new Ledger(dbPath);
  budget = new BudgetTracker();

  // Seed some data
  budget.getOrCreateSession("dash-s1", "agent-alpha");
  budget.recordSpend("dash-s1", "web_search", 50);
  budget.recordSpend("dash-s1", "code_review", 30);

  budget.getOrCreateSession("dash-s2", "agent-beta");
  budget.recordSpend("dash-s2", "file_read", 10);

  ledger.logCall({
    sessionId: "dash-s1",
    agentId: "agent-alpha",
    toolName: "web_search",
    costCents: 50,
    timestamp: Date.now() - 3000,
    blocked: false,
    reason: null,
    upstreamDurationMs: 120,
  });

  ledger.logCall({
    sessionId: "dash-s1",
    agentId: "agent-alpha",
    toolName: "code_review",
    costCents: 30,
    timestamp: Date.now() - 2000,
    blocked: false,
    reason: null,
    upstreamDurationMs: 80,
  });

  ledger.logCall({
    sessionId: "dash-s1",
    agentId: "agent-alpha",
    toolName: "send_email",
    costCents: 0,
    timestamp: Date.now() - 1000,
    blocked: true,
    reason: "blocked by policy",
    upstreamDurationMs: 0,
  });

  ledger.logCall({
    sessionId: "dash-s2",
    agentId: "agent-beta",
    toolName: "file_read",
    costCents: 10,
    timestamp: Date.now(),
    blocked: false,
    reason: null,
    upstreamDurationMs: 50,
  });
});

afterAll(() => {
  ledger.close();
  try {
    unlinkSync(dbPath);
    unlinkSync(dbPath + "-wal");
    unlinkSync(dbPath + "-shm");
  } catch {}
});

describe("Dashboard — renderDashboard", () => {
  test("returns valid HTML with expected elements", () => {
    const data = getDashboardData(budget, ledger);
    const html = renderDashboard(data);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("KYA — Know Your Agent");
    expect(html).toContain('meta http-equiv="refresh"');
    expect(html).toContain("Total Spend");
    expect(html).toContain("Active Sessions");
    expect(html).toContain("Total Calls");
    expect(html).toContain("Blocked Calls");
    expect(html).toContain("Agent Breakdown");
    expect(html).toContain("Recent Calls");
    expect(html).toContain("agent-alpha");
    expect(html).toContain("agent-beta");
  });
});

describe("Dashboard — getDashboardData", () => {
  test("returns correct structure", () => {
    const data = getDashboardData(budget, ledger);

    expect(data.totalSpentCents).toBe(90); // 50 + 30 + 10
    expect(data.totalCalls).toBe(4);
    expect(data.blockedCalls).toBe(1);
    expect(data.activeSessions).toBe(2);
    expect(Array.isArray(data.agentBreakdown)).toBe(true);
    expect(Array.isArray(data.recentCalls)).toBe(true);
    expect(Array.isArray(data.sessions)).toBe(true);
  });

  test("agent breakdown aggregation is correct", () => {
    const data = getDashboardData(budget, ledger);
    const alpha = data.agentBreakdown.find((a) => a.agentId === "agent-alpha");
    const beta = data.agentBreakdown.find((a) => a.agentId === "agent-beta");

    expect(alpha).toBeDefined();
    expect(alpha!.totalSpent).toBe(80); // 50 + 30 (blocked call excluded from spend)
    expect(alpha!.callCount).toBe(3);
    expect(alpha!.blockedCount).toBe(1);

    expect(beta).toBeDefined();
    expect(beta!.totalSpent).toBe(10);
    expect(beta!.callCount).toBe(1);
    expect(beta!.blockedCount).toBe(0);
  });
});
