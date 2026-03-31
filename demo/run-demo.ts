// KYA Demo Orchestrator
// Starts mock upstream, KYA proxy, runs traffic simulation, then keeps dashboard live

import { startMockUpstream } from "./mock-upstream.ts";
import { simulateTraffic } from "./simulate-traffic.ts";
import { loadConfig } from "../src/config.ts";
import { loadPolicies } from "../src/policy.ts";
import { BudgetTracker } from "../src/budget.ts";
import { Ledger } from "../src/ledger.ts";
import { createProxyHandler } from "../src/proxy.ts";
import { startServer } from "../src/server.ts";

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
};

console.log(`\n${C.bold}${C.cyan}╔═══════════════════════════════════════════╗${C.reset}`);
console.log(`${C.bold}${C.cyan}║   KYA — Know Your Agent Demo              ║${C.reset}`);
console.log(`${C.bold}${C.cyan}╚═══════════════════════════════════════════╝${C.reset}\n`);

// Step 1: Start mock upstream
console.log(`${C.dim}[1/3] Starting mock upstream server...${C.reset}`);
const mockServer = startMockUpstream(4001);

// Step 2: Start KYA proxy
console.log(`${C.dim}[2/3] Starting KYA proxy...${C.reset}`);

// Use demo-specific DB to avoid polluting the main one
const config = loadConfig();
const dbPath = "./kya-demo.sqlite";
const policies = loadPolicies(config.policyDir);
const ledger = new Ledger(dbPath);
const budget = new BudgetTracker();

const proxyHandler = createProxyHandler({
  upstreamUrl: "http://localhost:4001/mcp",
  policies,
  budget,
  ledger,
  jwtSecret: config.jwtSecret,
});

const proxyServer = startServer({
  port: config.port,
  host: config.host,
  proxyHandler,
  budget,
  ledger,
  jwtSecret: config.jwtSecret,
});

console.log(`${C.green}[KYA] Proxy running on http://${config.host}:${config.port}${C.reset}`);
console.log(`${C.green}[KYA] Policies loaded: ${policies.length}${C.reset}`);

// Step 3: Wait for servers to start, then run traffic
console.log(`${C.dim}[3/3] Waiting for servers to start...${C.reset}`);
await Bun.sleep(1000);

console.log(`${C.dim}[3/3] Running traffic simulation...${C.reset}`);
await simulateTraffic();

// Keep running for dashboard viewing
console.log(`${C.bold}${C.green}══════════════════════════════════════════════════════════${C.reset}`);
console.log(`${C.bold}${C.green}  Dashboard is live at http://localhost:${config.port}/dashboard${C.reset}`);
console.log(`${C.bold}${C.green}  Press Ctrl+C to stop${C.reset}`);
console.log(`${C.bold}${C.green}══════════════════════════════════════════════════════════${C.reset}\n`);

// Keep process alive
process.on("SIGINT", () => {
  console.log(`\n${C.dim}Shutting down...${C.reset}`);
  mockServer.stop();
  proxyServer.stop();
  process.exit(0);
});
