import { Database } from "bun:sqlite";

export interface WalletConfig {
  agentId: string;
  balanceCents: number;
  address: string;
  initialBalanceCents: number;
}

export interface WalletTransaction {
  id: number;
  agentId: string;
  amountCents: number;
  type: "debit" | "credit";
  description: string;
  timestamp: number;
  balanceAfter: number;
}

function generateAddress(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(20)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

export class WalletManager {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS wallets (
        agentId TEXT PRIMARY KEY,
        balanceCents INTEGER NOT NULL,
        initialBalanceCents INTEGER NOT NULL,
        address TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agentId TEXT NOT NULL,
        amountCents INTEGER NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        balanceAfter INTEGER NOT NULL
      )
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_agent ON wallet_transactions(agentId)
    `);
  }

  createWallet(agentId: string, initialBalanceCents: number): WalletConfig {
    const address = generateAddress();
    this.db.run(
      `INSERT OR REPLACE INTO wallets (agentId, balanceCents, initialBalanceCents, address) VALUES (?, ?, ?, ?)`,
      [agentId, initialBalanceCents, initialBalanceCents, address],
    );
    this.logTransaction(agentId, initialBalanceCents, "credit", "Initial wallet funding", initialBalanceCents);
    return { agentId, balanceCents: initialBalanceCents, initialBalanceCents, address };
  }

  getWallet(agentId: string): WalletConfig | undefined {
    const row = this.db.query("SELECT * FROM wallets WHERE agentId = ?").get(agentId) as Record<string, unknown> | null;
    if (!row) return undefined;
    return {
      agentId: row.agentId as string,
      balanceCents: row.balanceCents as number,
      initialBalanceCents: row.initialBalanceCents as number,
      address: row.address as string,
    };
  }

  getBalance(agentId: string): number {
    const wallet = this.getWallet(agentId);
    return wallet?.balanceCents ?? 0;
  }

  debit(agentId: string, amountCents: number, description = "x402 payment"): { success: boolean; reason?: string; newBalance: number } {
    const wallet = this.getWallet(agentId);
    if (!wallet) return { success: false, reason: "Wallet not found", newBalance: 0 };
    if (wallet.balanceCents < amountCents) {
      return { success: false, reason: `Insufficient balance: have ${wallet.balanceCents}¢, need ${amountCents}¢`, newBalance: wallet.balanceCents };
    }
    const newBalance = wallet.balanceCents - amountCents;
    this.db.run("UPDATE wallets SET balanceCents = ? WHERE agentId = ?", [newBalance, agentId]);
    this.logTransaction(agentId, amountCents, "debit", description, newBalance);
    return { success: true, newBalance };
  }

  credit(agentId: string, amountCents: number, description = "Manual credit"): number {
    const wallet = this.getWallet(agentId);
    if (!wallet) return 0;
    const newBalance = wallet.balanceCents + amountCents;
    this.db.run("UPDATE wallets SET balanceCents = ? WHERE agentId = ?", [newBalance, agentId]);
    this.logTransaction(agentId, amountCents, "credit", description, newBalance);
    return newBalance;
  }

  listWallets(): WalletConfig[] {
    const rows = this.db.query("SELECT * FROM wallets").all() as Record<string, unknown>[];
    return rows.map((row) => ({
      agentId: row.agentId as string,
      balanceCents: row.balanceCents as number,
      initialBalanceCents: row.initialBalanceCents as number,
      address: row.address as string,
    }));
  }

  getTransactions(agentId: string): WalletTransaction[] {
    const rows = this.db
      .query("SELECT * FROM wallet_transactions WHERE agentId = ? ORDER BY timestamp DESC")
      .all(agentId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      agentId: r.agentId as string,
      amountCents: r.amountCents as number,
      type: r.type as "debit" | "credit",
      description: r.description as string,
      timestamp: r.timestamp as number,
      balanceAfter: r.balanceAfter as number,
    }));
  }

  private logTransaction(agentId: string, amountCents: number, type: "debit" | "credit", description: string, balanceAfter: number): void {
    this.db.run(
      `INSERT INTO wallet_transactions (agentId, amountCents, type, description, timestamp, balanceAfter) VALUES (?, ?, ?, ?, ?, ?)`,
      [agentId, amountCents, type, description, Date.now(), balanceAfter],
    );
  }

  close(): void {
    this.db.close();
  }
}
