import type { WalletConfig, OnchainWalletConfig } from "./wallet.ts";
import type { ChainConfig } from "./chain.ts";
import { transferUsdc } from "./chain.ts";

export interface X402Challenge {
  price: number;
  currency: string;
  chain: string;
  recipient: string;
  description?: string;
  expiresAt?: number;
}

export interface X402Receipt {
  txHash: string;
  payer: string;
  amount: number;
  currency: string;
  timestamp: number;
}

export function parseX402Challenge(response: Response): X402Challenge | null {
  if (response.status !== 402) return null;

  const price = response.headers.get("X-Payment-Price");
  const currency = response.headers.get("X-Payment-Currency") || "USDC";
  const chain = response.headers.get("X-Payment-Chain") || "base";
  const recipient = response.headers.get("X-Payment-Recipient");
  const description = response.headers.get("X-Payment-Description") || undefined;
  const expiresAtStr = response.headers.get("X-Payment-Expires");

  if (!price || !recipient) return null;

  return {
    price: parseInt(price, 10),
    currency,
    chain,
    recipient,
    description,
    expiresAt: expiresAtStr ? parseInt(expiresAtStr, 10) : undefined,
  };
}

export function createPaymentReceipt(challenge: X402Challenge, wallet: WalletConfig): X402Receipt {
  return {
    txHash: `0x${crypto.randomUUID().replace(/-/g, "")}`,
    payer: wallet.address,
    amount: challenge.price,
    currency: challenge.currency,
    timestamp: Date.now(),
  };
}

export async function createRealPaymentReceipt(
  challenge: X402Challenge,
  wallet: OnchainWalletConfig & { privateKey: string },
  chainConfig: ChainConfig,
): Promise<X402Receipt> {
  const txHash = await transferUsdc({
    privateKey: wallet.privateKey,
    to: challenge.recipient,
    amountCents: challenge.price,
    config: chainConfig,
  });
  return {
    txHash,
    payer: wallet.address,
    amount: challenge.price,
    currency: challenge.currency,
    timestamp: Date.now(),
  };
}

export function attachPaymentProof(request: Request, receipt: X402Receipt): Request {
  const headers = new Headers(request.headers);
  headers.set("X-Payment-TxHash", receipt.txHash);
  headers.set("X-Payment-Payer", receipt.payer);
  headers.set("X-Payment-Amount", String(receipt.amount));
  headers.set("X-Payment-Currency", receipt.currency);
  headers.set("X-Payment-Timestamp", String(receipt.timestamp));
  return new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    duplex: "half" as any,
  });
}
