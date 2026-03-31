import { loadConfig } from "./config.ts";
import { loadPolicies } from "./policy.ts";
import { BudgetTracker } from "./budget.ts";
import { Ledger } from "./ledger.ts";
import { createProxyHandler } from "./proxy.ts";
import { startServer } from "./server.ts";

const config = loadConfig();
const policies = loadPolicies(config.policyDir);
const ledger = new Ledger(config.dbPath);
const budget = new BudgetTracker();

const proxyHandler = createProxyHandler({
  upstreamUrl: config.upstreamUrl,
  policies,
  budget,
  ledger,
  jwtSecret: config.jwtSecret,
});

const server = startServer({
  port: config.port,
  host: config.host,
  proxyHandler,
  budget,
  ledger,
  jwtSecret: config.jwtSecret,
});

console.log(`[KYA] Know Your Agent proxy started`);
console.log(`[KYA] Listening on http://${config.host}:${config.port}`);
console.log(`[KYA] Upstream MCP: ${config.upstreamUrl}`);
console.log(`[KYA] Policies loaded: ${policies.length}`);
console.log(`[KYA] Database: ${config.dbPath}`);
