import type { BudgetTracker } from "./budget.ts";
import type { Ledger } from "./ledger.ts";
import type { LedgerEntry, SessionState } from "./types.ts";

export interface AgentBreakdown {
  agentId: string;
  totalSpent: number;
  callCount: number;
  blockedCount: number;
}

export interface SessionSummary {
  sessionId: string;
  agentId: string;
  totalSpentCents: number;
  callCount: number;
  startedAt: number;
  topTools: { tool: string; spend: number }[];
}

export interface DashboardData {
  totalSpentCents: number;
  totalCalls: number;
  blockedCalls: number;
  activeSessions: number;
  agentBreakdown: AgentBreakdown[];
  recentCalls: LedgerEntry[];
  sessions: SessionSummary[];
}

export function getDashboardData(budget: BudgetTracker, ledger: Ledger): DashboardData {
  const totalCalls = ledger.getTotalCalls();
  const blockedCalls = ledger.getBlockedCalls();
  const agentBreakdown = ledger.getAgentBreakdown();
  const recentCalls = ledger.getRecentCalls(20);

  const activeSessions = budget.getActiveSessions();
  const totalSpentCents = activeSessions.reduce((sum, s) => sum + s.totalSpentCents, 0);

  const sessions: SessionSummary[] = activeSessions.map((s) => ({
    sessionId: s.sessionId,
    agentId: s.agentId,
    totalSpentCents: s.totalSpentCents,
    callCount: s.callCount,
    startedAt: s.startedAt,
    topTools: Object.entries(s.toolSpend)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tool, spend]) => ({ tool, spend })),
  }));

  return {
    totalSpentCents,
    totalCalls,
    blockedCalls,
    activeSessions: activeSessions.length,
    agentBreakdown,
    recentCalls,
    sessions,
  };
}
