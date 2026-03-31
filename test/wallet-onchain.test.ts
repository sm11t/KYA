import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { WalletManager, encryptPrivateKey, decryptPrivateKey } from "../src/wallet.ts";
import { tmpdir } from "os";
import { join } from "path";

const TEST_SECRET = "test-jwt-secret-for-wallet-encryption";

describe("Onchain Wallet", () => {
  let wm: WalletManager;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `kya-onchain-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    wm = new WalletManager(dbPath);
  });

  afterEach(() => {
    wm.close();
    try { require("fs").unlinkSync(dbPath); } catch {}
  });

  test("createOnchainWallet creates wallet with valid address", async () => {
    const wallet = await wm.createOnchainWallet("onchain-agent", TEST_SECRET);
    expect(wallet.agentId).toBe("onchain-agent");
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(wallet.mode).toBe("onchain");
  });

  test("onchain wallet is stored and retrievable", async () => {
    await wm.createOnchainWallet("onchain-agent", TEST_SECRET);
    const stored = wm.getOnchainWallet("onchain-agent");
    expect(stored).toBeDefined();
    expect(stored!.agentId).toBe("onchain-agent");
    expect(stored!.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(stored!.encryptedPrivateKey).toBeTruthy();
    expect(stored!.iv).toBeTruthy();
    expect(stored!.authTag).toBeTruthy();
  });

  test("encrypted private key can be decrypted", async () => {
    await wm.createOnchainWallet("decrypt-agent", TEST_SECRET);
    const key = await wm.decryptWalletKey("decrypt-agent", TEST_SECRET);
    expect(key).toBeDefined();
    expect(key!).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  test("decryption with wrong secret fails", async () => {
    await wm.createOnchainWallet("wrong-secret-agent", TEST_SECRET);
    const stored = wm.getOnchainWallet("wrong-secret-agent")!;
    await expect(
      decryptPrivateKey(stored.encryptedPrivateKey, stored.iv, stored.authTag, "wrong-secret")
    ).rejects.toThrow();
  });

  test("listOnchainWallets returns onchain wallets", async () => {
    await wm.createOnchainWallet("agent-a", TEST_SECRET);
    await wm.createOnchainWallet("agent-b", TEST_SECRET);
    const wallets = wm.listOnchainWallets();
    expect(wallets).toHaveLength(2);
    expect(wallets.every((w) => w.mode === "onchain")).toBe(true);
  });

  test("listAllWallets includes both simulated and onchain", async () => {
    wm.createWallet("sim-agent", 1000);
    await wm.createOnchainWallet("chain-agent", TEST_SECRET);
    const all = wm.listAllWallets();
    expect(all).toHaveLength(2);
    const modes = all.map((w) => w.mode);
    expect(modes).toContain("simulated");
    expect(modes).toContain("onchain");
  });

  test("getOnchainWallet returns undefined for nonexistent", () => {
    const w = wm.getOnchainWallet("nope");
    expect(w).toBeUndefined();
  });
});

describe("AES-256-GCM encryption roundtrip", () => {
  test("encrypt and decrypt returns original value", async () => {
    const original = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const encrypted = await encryptPrivateKey(original, TEST_SECRET);
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.authTag).toBeTruthy();
    const decrypted = await decryptPrivateKey(encrypted.ciphertext, encrypted.iv, encrypted.authTag, TEST_SECRET);
    expect(decrypted).toBe(original);
  });

  test("different plaintexts produce different ciphertexts", async () => {
    const a = await encryptPrivateKey("secret-a", TEST_SECRET);
    const b = await encryptPrivateKey("secret-b", TEST_SECRET);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});
