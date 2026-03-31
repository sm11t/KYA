export interface Policy {
  agent: string;
  sessionBudget: number;
  perCallMax: number;
  allowedTools: string[];
  blockedTools: string[];
  rateLimit: { maxCallsPerMinute: number };
  alertThresholds: number[];
}

export interface LedgerEntry {
  id: number;
  sessionId: string;
  agentId: string;
  toolName: string;
  costCents: number;
  timestamp: number;
  blocked: boolean;
  reason: string | null;
  upstreamDurationMs: number;
}

export interface SessionState {
  sessionId: string;
  agentId: string;
  totalSpentCents: number;
  callCount: number;
  startedAt: number;
  toolSpend: Record<string, number>;
  recentCallTimestamps: number[];
}

export interface ProxyConfig {
  port: number;
  host: string;
  upstreamUrl: string;
  policyDir: string;
  dbPath: string;
  jwtSecret: string;
}
