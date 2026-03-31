// KYA x402 Demo Orchestrator
// Demonstrates the x402 payment protocol flow with wallet management

import { startMockX402Upstream } from "./mock-upstream-x402.ts";
import { loadConfig } from "../src/config.ts";
import { loadPolicies } from "../src/policy.ts";
import { BudgetTracker } from "../src/budget.ts";
import { Ledger } from "../src/ledger.ts";
import { WalletManager } from "../src/wallet.ts";
import { createX402ProxyHandler } from "../src/x402-proxy.ts";
import { startServer } from "../src/server.ts";

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

const PROXY_URL = "http://localhost:3457/mcp";

console.log(`\n${C.bold}${C.cyan}╔═══════════════════════════════════════════╗${C.reset}`);
console.log(`${C.bold}${C.cyan}║   KYA — x402 Payment Protocol Demo        ║${C.reset}`);
console.log(`${C.bold}${C.cyan}╚═══════════════════════════════════════════╝${C.reset}\n`);

// Step 1: Start mock x402 upstream
console.log(`${C.dim}[1/4] Starting mock x402 upstream server...${C.reset}`);
const mockServer = startMockX402Upstream(4002);

// Step 2: Start KYA proxy with wallet support
console.log(`${C.dim}[2/4] Starting KYA x402 proxy...${C.reset}`);

const config = loadConfig();
const dbPath = "./kya-x402-demo.sqlite";
const policies = loadPolicies(config.policyDir);
const ledger = new Ledger(dbPath);
const budget = new BudgetTracker();
const walletManager = new WalletManager(dbPath);

const proxyHandler = createX402ProxyHandler({
  upstreamUrl: "http://localhost:4002/mcp",
  policies,
  budget,
  ledger,
  walletManager,
  jwtSecret: config.jwtSecret,
});

const proxyServer = startServer({
  port: 3457,
  host: config.host,
  proxyHandler,
  budget,
  ledger,
  jwtSecret: config.jwtSecret,
  walletManager,
});

console.log(`${C.green}[KYA] x402 Proxy running on http://${config.host}:3457${C.reset}`);

// Step 3: Create wallets
console.log(`${C.dim}[3/4] Creating agent wallets...${C.reset}`);

const researchWallet = walletManager.createWallet("research-bot", 1000); // $10
const coderWallet = walletManager.createWallet("x402-coder", 250);      // $2.50 — will drain

console.log(`  ${C.cyan}research-bot${C.reset} wallet: ${researchWallet.address.slice(0, 14)}... (${C.green}$${(researchWallet.balanceCents / 100).toFixed(2)}${C.reset})`);
console.log(`  ${C.blue}x402-coder${C.reset}   wallet: ${coderWallet.address.slice(0, 14)}... (${C.green}$${(coderWallet.balanceCents / 100).toFixed(2)}${C.reset}) — low balance, will drain!`);

// Step 4: Run x402 traffic
console.log(`\n${C.dim}[4/4] Running x402 traffic simulation...${C.reset}`);
await Bun.sleep(500);

async function callTool(agentId: string, sessionId: string, toolName: string): Promise<{ blocked: boolean; cost: number }> {
  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Id": agentId,
        "X-Session-Id": sessionId,
        "X-Tool-Cost": "0", // x402 tools have dynamic pricing via 402 response
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: toolName, arguments: { input: "demo" } },
        id: Date.now(),
      }),
    });

    const body = await res.json();
    const blocked = !!body.error;
    const color = agentId === "research-bot" ? C.cyan : agentId === "x402-coder" ? C.blue : C.magenta;

    if (blocked) {
      console.log(`  ${color}${agentId}${C.reset} → ${toolName} ${C.red}✗ BLOCKED${C.reset} ${C.dim}(${body.error.message})${C.reset}`);
      return { blocked: true, cost: 0 };
    } else {
      const wallet = walletManager.getWallet(agentId);
      console.log(`  ${color}${agentId}${C.reset} → ${toolName} ${C.green}✓ PAID${C.reset} ${C.dim}(balance: ${wallet?.balanceCents ?? 0}¢)${C.reset}`);
      return { blocked: false, cost: 0 };
    }
  } catch (err) {
    console.log(`  ${C.red}ERROR: ${err}${C.reset}`);
    return { blocked: true, cost: 0 };
  }
}

console.log(`\n${C.bold}═══════════════════════════════════════════════════════════${C.reset}`);
console.log(`${C.bold}  x402 Payment Flow Demo${C.reset}`);
console.log(`${C.bold}═══════════════════════════════════════════════════════════${C.reset}\n`);

// research-bot: Has $10, uses premium_search (10¢) and deep_analysis (100¢)
console.log(`${C.bold}${C.cyan}  [research-bot] Premium searches (10¢ each)...${C.reset}`);
const researchSession = `research-x402-${Date.now()}`;
for (let i = 0; i < 5; i++) {
  await callTool("research-bot", researchSession, "premium_search");
  await Bun.sleep(300);
}

console.log(`\n${C.bold}${C.cyan}  [research-bot] Deep analysis (100¢ each)...${C.reset}`);
for (let i = 0; i < 4; i++) {
  await callTool("research-bot", researchSession, "deep_analysis");
  await Bun.sleep(400);
}

// x402-coder: Has $2.50 (250¢), uses code_audit (50¢ each) — runs out after 5
console.log(`\n${C.bold}${C.blue}  [x402-coder] Code audits (50¢ each, only $2.50 in wallet)...${C.reset}`);
const codingSession = `coder-x402-${Date.now()}`;
for (let i = 0; i < 8; i++) {
  await callTool("x402-coder", codingSession, "code_audit");
  await Bun.sleep(400);
}

// Try premium_search after wallet is drained
console.log(`\n${C.bold}${C.blue}  [x402-coder] Attempting premium_search after wallet drain...${C.reset}`);
for (let i = 0; i < 3; i++) {
  await callTool("x402-coder", codingSession, "premium_search");
  await Bun.sleep(300);
}

// Final summary
console.log(`\n${C.bold}═══════════════════════════════════════════════════════════${C.reset}`);
console.log(`${C.bold}  Final Wallet Balances${C.reset}`);
console.log(`${C.bold}═══════════════════════════════════════════════════════════${C.reset}\n`);

for (const agentId of ["research-bot", "x402-coder"]) {
  const wallet = walletManager.getWallet(agentId);
  if (wallet) {
    const initial = wallet.initialBalanceCents ?? wallet.balanceCents;
    const pct = initial > 0 ? wallet.balanceCents / initial : 0;
    const color = pct > 0.5 ? C.green : pct > 0.2 ? C.yellow : C.red;
    console.log(`  ${agentId}: ${color}$${(wallet.balanceCents / 100).toFixed(2)}${C.reset} remaining (was $${(initial / 100).toFixed(2)})`);
  }
}

const txns = walletManager.getTransactions("x402-coder");
console.log(`\n  ${C.blue}x402-coder${C.reset} transactions: ${txns.length}`);

console.log(`\n${C.bold}${C.green}══════════════════════════════════════════════════════════${C.reset}`);
console.log(`${C.bold}${C.green}  Dashboard is live at http://localhost:3457/dashboard${C.reset}`);
console.log(`${C.bold}${C.green}  Press Ctrl+C to stop${C.reset}`);
console.log(`${C.bold}${C.green}══════════════════════════════════════════════════════════${C.reset}\n`);

process.on("SIGINT", () => {
  console.log(`\n${C.dim}Shutting down...${C.reset}`);
  mockServer.stop();
  proxyServer.stop();
  walletManager.close();
  process.exit(0);
});
