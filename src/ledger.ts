import { Database } from "bun:sqlite";
import type { LedgerEntry } from "./types.ts";

export class Ledger {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT NOT NULL,
        agentId TEXT NOT NULL,
        toolName TEXT NOT NULL,
        costCents INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        blocked INTEGER NOT NULL DEFAULT 0,
        reason TEXT,
        upstreamDurationMs INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_ledger_session ON ledger(sessionId)
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_ledger_agent ON ledger(agentId)
    `);
  }

  logCall(entry: Omit<LedgerEntry, "id">): void {
    this.db.run(
      `INSERT INTO ledger (sessionId, agentId, toolName, costCents, timestamp, blocked, reason, upstreamDurationMs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.sessionId,
        entry.agentId,
        entry.toolName,
        entry.costCents,
        entry.timestamp,
        entry.blocked ? 1 : 0,
        entry.reason,
        entry.upstreamDurationMs,
      ],
    );
  }

  getSessionCalls(sessionId: string): LedgerEntry[] {
    return this.db
      .query("SELECT * FROM ledger WHERE sessionId = ? ORDER BY timestamp DESC")
      .all(sessionId)
      .map(mapRow);
  }

  getTotalSpend(agentId?: string, since?: number): number {
    let sql = "SELECT COALESCE(SUM(costCents), 0) as total FROM ledger WHERE blocked = 0";
    const params: (string | number)[] = [];

    if (agentId) {
      sql += " AND agentId = ?";
      params.push(agentId);
    }
    if (since !== undefined) {
      sql += " AND timestamp >= ?";
      params.push(since);
    }

    const row = this.db.query(sql).get(...params) as { total: number };
    return row.total;
  }

  getRecentCalls(limit: number): LedgerEntry[] {
    return this.db
      .query("SELECT * FROM ledger ORDER BY timestamp DESC LIMIT ?")
      .all(limit)
      .map(mapRow);
  }

  close(): void {
    this.db.close();
  }
}

function mapRow(row: unknown): LedgerEntry {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as number,
    sessionId: r.sessionId as string,
    agentId: r.agentId as string,
    toolName: r.toolName as string,
    costCents: r.costCents as number,
    timestamp: r.timestamp as number,
    blocked: (r.blocked as number) === 1,
    reason: (r.reason as string) || null,
    upstreamDurationMs: r.upstreamDurationMs as number,
  };
}
