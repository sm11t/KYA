import type { Policy, SessionState } from "./types.ts";

export class BudgetTracker {
  private sessions = new Map<string, SessionState>();

  startSession(sessionId: string, agentId: string): SessionState {
    const session: SessionState = {
      sessionId,
      agentId,
      totalSpentCents: 0,
      callCount: 0,
      startedAt: Date.now(),
      toolSpend: {},
      recentCallTimestamps: [],
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  getOrCreateSession(sessionId: string, agentId: string): SessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    return this.startSession(sessionId, agentId);
  }

  recordSpend(sessionId: string, toolName: string, costCents: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.totalSpentCents += costCents;
    session.callCount += 1;
    session.toolSpend[toolName] = (session.toolSpend[toolName] || 0) + costCents;
    session.recentCallTimestamps.push(Date.now());
  }

  refundSpend(sessionId: string, toolName: string, costCents: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.totalSpentCents = Math.max(0, session.totalSpentCents - costCents);
    session.callCount = Math.max(0, session.callCount - 1);
    session.toolSpend[toolName] = Math.max(0, (session.toolSpend[toolName] || 0) - costCents);
  }

  checkAlerts(sessionId: string, policy: Policy): number[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    const ratio = session.totalSpentCents / policy.sessionBudget;
    return policy.alertThresholds.filter((t) => ratio >= t);
  }

  getActiveSessions(): SessionState[] {
    return Array.from(this.sessions.values());
  }
}
