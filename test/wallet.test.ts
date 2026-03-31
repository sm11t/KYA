import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { WalletManager } from "../src/wallet.ts";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("WalletManager", () => {
  let walletManager: WalletManager;
  let dbPath: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kya-wallet-test-"));
    dbPath = join(tmpDir, "test.sqlite");
    walletManager = new WalletManager(dbPath);
  });

  afterEach(() => {
    walletManager.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a wallet with initial balance", () => {
    const wallet = walletManager.createWallet("agent-1", 1000);
    expect(wallet.agentId).toBe("agent-1");
    expect(wallet.balanceCents).toBe(1000);
    expect(wallet.initialBalanceCents).toBe(1000);
    expect(wallet.address).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it("debit reduces balance", () => {
    walletManager.createWallet("agent-1", 1000);
    const result = walletManager.debit("agent-1", 250);
    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(750);
    expect(walletManager.getBalance("agent-1")).toBe(750);
  });

  it("debit fails when insufficient funds", () => {
    walletManager.createWallet("agent-1", 100);
    const result = walletManager.debit("agent-1", 200);
    expect(result.success).toBe(false);
    expect(result.reason).toContain("Insufficient balance");
    expect(result.newBalance).toBe(100);
    expect(walletManager.getBalance("agent-1")).toBe(100);
  });

  it("credit increases balance", () => {
    walletManager.createWallet("agent-1", 500);
    const newBalance = walletManager.credit("agent-1", 300);
    expect(newBalance).toBe(800);
    expect(walletManager.getBalance("agent-1")).toBe(800);
  });

  it("list wallets returns all", () => {
    walletManager.createWallet("agent-1", 1000);
    walletManager.createWallet("agent-2", 500);
    walletManager.createWallet("agent-3", 250);
    const wallets = walletManager.listWallets();
    expect(wallets.length).toBe(3);
    const ids = wallets.map((w) => w.agentId).sort();
    expect(ids).toEqual(["agent-1", "agent-2", "agent-3"]);
  });

  it("wallet persists across close and reopen", () => {
    walletManager.createWallet("agent-1", 1000);
    walletManager.debit("agent-1", 300);
    walletManager.close();

    // Reopen
    const walletManager2 = new WalletManager(dbPath);
    const wallet = walletManager2.getWallet("agent-1");
    expect(wallet).toBeDefined();
    expect(wallet!.balanceCents).toBe(700);
    expect(wallet!.address).toMatch(/^0x[0-9a-f]{40}$/);
    walletManager2.close();

    // Reassign so afterEach doesn't double-close
    walletManager = new WalletManager(dbPath);
  });

  it("getWallet returns undefined for nonexistent agent", () => {
    expect(walletManager.getWallet("nope")).toBeUndefined();
  });

  it("getBalance returns 0 for nonexistent agent", () => {
    expect(walletManager.getBalance("nope")).toBe(0);
  });

  it("tracks transactions", () => {
    walletManager.createWallet("agent-1", 1000);
    walletManager.debit("agent-1", 100, "payment 1");
    walletManager.debit("agent-1", 200, "payment 2");
    walletManager.credit("agent-1", 50, "refund");

    const txns = walletManager.getTransactions("agent-1");
    expect(txns.length).toBe(4); // 1 initial credit + 2 debits + 1 credit
    const types = txns.map((t) => t.type);
    expect(types.filter((t) => t === "debit").length).toBe(2);
    expect(types.filter((t) => t === "credit").length).toBe(2); // initial + refund
    const descriptions = txns.map((t) => t.description);
    expect(descriptions).toContain("payment 1");
    expect(descriptions).toContain("payment 2");
    expect(descriptions).toContain("refund");
  });

  it("debit on nonexistent wallet fails gracefully", () => {
    const result = walletManager.debit("nope", 100);
    expect(result.success).toBe(false);
    expect(result.reason).toContain("Wallet not found");
  });
});
