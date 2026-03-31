import { Database } from "bun:sqlite";
import { generateWallet as generateOnchainKeypair, getAddress as deriveAddress } from "./chain.ts";
import type { ChainConfig } from "./chain.ts";
import { getUsdcBalance, transferUsdc } from "./chain.ts";

export type WalletMode = "simulated" | "onchain";

export interface WalletConfig {
  agentId: string;
  balanceCents: number;
  address: string;
  initialBalanceCents: number;
  mode?: WalletMode;
}

export interface OnchainWalletConfig {
  agentId: string;
  address: string;
  mode: "onchain";
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
    this.db.run(`
      CREATE TABLE IF NOT EXISTS onchain_wallets (
        agentId TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        encryptedPrivateKey TEXT NOT NULL,
        iv TEXT NOT NULL,
        authTag TEXT NOT NULL
      )
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

  // --- On-chain wallet methods ---

  async createOnchainWallet(agentId: string, jwtSecret: string): Promise<OnchainWalletConfig> {
    const { privateKey, address } = generateOnchainKeypair();
    const { ciphertext, iv, authTag } = await encryptPrivateKey(privateKey, jwtSecret);
    this.db.run(
      `INSERT OR REPLACE INTO onchain_wallets (agentId, address, encryptedPrivateKey, iv, authTag) VALUES (?, ?, ?, ?, ?)`,
      [agentId, address, ciphertext, iv, authTag],
    );
    return { agentId, address, mode: "onchain" };
  }

  getOnchainWallet(agentId: string): { agentId: string; address: string; encryptedPrivateKey: string; iv: string; authTag: string } | undefined {
    const row = this.db.query("SELECT * FROM onchain_wallets WHERE agentId = ?").get(agentId) as Record<string, unknown> | null;
    if (!row) return undefined;
    return {
      agentId: row.agentId as string,
      address: row.address as string,
      encryptedPrivateKey: row.encryptedPrivateKey as string,
      iv: row.iv as string,
      authTag: row.authTag as string,
    };
  }

  async getOnchainBalance(agentId: string, config: ChainConfig): Promise<number> {
    const wallet = this.getOnchainWallet(agentId);
    if (!wallet) return 0;
    return getUsdcBalance(wallet.address, config);
  }

  async debitOnchain(
    agentId: string,
    amountCents: number,
    recipient: string,
    jwtSecret: string,
    config: ChainConfig,
  ): Promise<{ success: boolean; txHash?: string; reason?: string }> {
    const wallet = this.getOnchainWallet(agentId);
    if (!wallet) return { success: false, reason: "Onchain wallet not found" };

    const privateKey = await decryptPrivateKey(wallet.encryptedPrivateKey, wallet.iv, wallet.authTag, jwtSecret);

    try {
      const txHash = await transferUsdc({
        privateKey,
        to: recipient,
        amountCents,
        config,
      });
      return { success: true, txHash };
    } catch (err) {
      return { success: false, reason: `Transfer failed: ${err}` };
    }
  }

  async decryptWalletKey(agentId: string, jwtSecret: string): Promise<string | undefined> {
    const wallet = this.getOnchainWallet(agentId);
    if (!wallet) return undefined;
    return decryptPrivateKey(wallet.encryptedPrivateKey, wallet.iv, wallet.authTag, jwtSecret);
  }

  listOnchainWallets(): OnchainWalletConfig[] {
    const rows = this.db.query("SELECT agentId, address FROM onchain_wallets").all() as Record<string, unknown>[];
    return rows.map((row) => ({
      agentId: row.agentId as string,
      address: row.address as string,
      mode: "onchain" as const,
    }));
  }

  listAllWallets(): (WalletConfig | OnchainWalletConfig)[] {
    const simulated = this.listWallets().map((w) => ({ ...w, mode: "simulated" as const }));
    const onchain = this.listOnchainWallets();
    return [...simulated, ...onchain];
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

// --- AES-256-GCM encryption via Web Crypto API ---

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode("kya-wallet-salt"), iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptPrivateKey(
  privateKey: string,
  secret: string,
): Promise<{ ciphertext: string; iv: string; authTag: string }> {
  const key = await deriveAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(privateKey));
  // AES-GCM appends 16-byte auth tag to ciphertext
  const encryptedBytes = new Uint8Array(encrypted);
  const ciphertextBytes = encryptedBytes.slice(0, encryptedBytes.length - 16);
  const authTagBytes = encryptedBytes.slice(encryptedBytes.length - 16);
  return {
    ciphertext: Buffer.from(ciphertextBytes).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    authTag: Buffer.from(authTagBytes).toString("base64"),
  };
}

export async function decryptPrivateKey(ciphertext: string, iv: string, authTag: string, secret: string): Promise<string> {
  const key = await deriveAesKey(secret);
  const ivBytes = Buffer.from(iv, "base64");
  const ciphertextBytes = Buffer.from(ciphertext, "base64");
  const authTagBytes = Buffer.from(authTag, "base64");
  // Reassemble: ciphertext + authTag for AES-GCM
  const combined = new Uint8Array(ciphertextBytes.length + authTagBytes.length);
  combined.set(ciphertextBytes, 0);
  combined.set(authTagBytes, ciphertextBytes.length);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, key, combined);
  return new TextDecoder().decode(decrypted);
}
