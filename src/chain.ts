import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, parseUnits } from "viem";
import { base, baseSepolia } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

// USDC contract addresses
const USDC_ADDRESSES: Record<string, `0x${string}`> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

const USDC_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export interface ChainConfig {
  chain: "base" | "base-sepolia";
  rpcUrl?: string;
}

const CHAIN_MAP = {
  base,
  "base-sepolia": baseSepolia,
} as const;

/** Create a Base public client (for reading) */
export function createBaseClient(config: ChainConfig) {
  const chain = CHAIN_MAP[config.chain];
  return createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });
}

/** Get USDC balance for an address (returns cents) */
export async function getUsdcBalance(address: string, config: ChainConfig): Promise<number> {
  const client = createBaseClient(config);
  const usdcAddress = USDC_ADDRESSES[config.chain];
  const raw = await client.readContract({
    address: usdcAddress,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });
  // USDC has 6 decimals. raw is in smallest unit. 1 cent = 10^4 units.
  // cents = raw / 10^4
  return Number(raw) / 10_000;
}

/** Transfer USDC (returns tx hash) */
export async function transferUsdc(params: {
  privateKey: string;
  to: string;
  amountCents: number;
  config: ChainConfig;
}): Promise<string> {
  const chain = CHAIN_MAP[params.config.chain];
  const account = privateKeyToAccount(params.privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(params.config.rpcUrl),
  });

  const usdcAddress = USDC_ADDRESSES[params.config.chain];
  // Convert cents to USDC smallest unit: 1 cent = 10^4 units
  const amount = BigInt(params.amountCents) * 10_000n;

  const hash = await walletClient.writeContract({
    address: usdcAddress,
    abi: USDC_ABI,
    functionName: "transfer",
    args: [params.to as `0x${string}`, amount],
  });

  return hash;
}

/** Generate a new wallet (private key + address) */
export function generateWallet(): { privateKey: string; address: string } {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}

/** Derive address from private key */
export function getAddress(privateKey: string): string {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return account.address;
}

export { USDC_ADDRESSES };
