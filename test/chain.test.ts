import { describe, test, expect } from "bun:test";
import { generateWallet, getAddress, USDC_ADDRESSES } from "../src/chain.ts";

describe("chain — wallet generation", () => {
  test("generateWallet returns valid address format", () => {
    const wallet = generateWallet();
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(wallet.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  test("getAddress derives correct address from private key", () => {
    const wallet = generateWallet();
    const derived = getAddress(wallet.privateKey);
    expect(derived).toBe(wallet.address);
  });

  test("generates unique wallets", () => {
    const w1 = generateWallet();
    const w2 = generateWallet();
    expect(w1.address).not.toBe(w2.address);
    expect(w1.privateKey).not.toBe(w2.privateKey);
  });

  test("USDC addresses are valid format", () => {
    expect(USDC_ADDRESSES["base"]).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(USDC_ADDRESSES["base-sepolia"]).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
