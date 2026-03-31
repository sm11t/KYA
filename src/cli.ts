#!/usr/bin/env bun

// KYA CLI — Know Your Agent
// Parse process.argv manually, no external deps

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
};

// ─── Helpers ────────────────────────────────────────────────

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function die(msg: string): never {
  console.error(`${C.red}${C.bold}Error:${C.reset} ${msg}`);
  process.exit(1);
}

function banner() {
  console.log(`
${C.cyan}${C.bold}  ██╗  ██╗██╗   ██╗ █████╗ ${C.reset}
${C.cyan}${C.bold}  ██║ ██╔╝╚██╗ ██╔╝██╔══██╗${C.reset}
${C.cyan}${C.bold}  █████╔╝  ╚████╔╝ ███████║${C.reset}
${C.cyan}${C.bold}  ██╔═██╗   ╚██╔╝  ██╔══██║${C.reset}
${C.cyan}${C.bold}  ██║  ██╗   ██║   ██║  ██║${C.reset}
${C.cyan}${C.bold}  ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝${C.reset}
${C.dim}  Know Your Agent — spending control for AI agents${C.reset}
`);
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ─── Commands ───────────────────────────────────────────────

async function cmdInit() {
  const fs = await import("fs");
  const path = await import("path");

  const configPath = path.join(process.cwd(), "kya.config.json");
  const policiesDir = path.join(process.cwd(), "policies");

  const defaultConfig = {
    port: 3456,
    host: "localhost",
    upstream: "http://localhost:4001/mcp",
    policyDir: "./policies",
    dbPath: "./kya.sqlite",
    jwtSecret: "change-me",
    x402: false,
  };

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + "\n");
    console.log(`${C.green}✓${C.reset} Created ${C.bold}kya.config.json${C.reset}`);
  } else {
    console.log(`${C.yellow}→${C.reset} kya.config.json already exists, skipping`);
  }

  if (!fs.existsSync(policiesDir)) {
    fs.mkdirSync(policiesDir, { recursive: true });
    const defaultPolicy = {
      agent: "default",
      sessionBudget: 1000,
      perCallMax: 100,
      allowedTools: [],
      blockedTools: [],
      rateLimit: { maxCallsPerMinute: 60 },
      alertThresholds: [0.5, 0.8, 0.95],
    };
    fs.writeFileSync(
      path.join(policiesDir, "default.json"),
      JSON.stringify(defaultPolicy, null, 2) + "\n",
    );
    console.log(`${C.green}✓${C.reset} Created ${C.bold}policies/${C.reset} with default policy`);
  } else {
    console.log(`${C.yellow}→${C.reset} policies/ already exists, skipping`);
  }

  console.log(
    `\n${C.green}KYA initialized.${C.reset} Edit ${C.bold}kya.config.json${C.reset} and add policies, then run: ${C.cyan}kya start${C.reset}`,
  );
}

async function cmdStart(flags: Record<string, string | boolean>) {
  banner();

  const { loadConfig } = await import("./config.ts");
  const { loadPolicies } = await import("./policy.ts");
  const { BudgetTracker } = await import("./budget.ts");
  const { Ledger } = await import("./ledger.ts");
  const { startServer } = await import("./server.ts");

  const config = loadConfig();

  // CLI flags override config
  if (flags.port) config.port = parseInt(flags.port as string, 10);
  if (flags.upstream) config.upstreamUrl = flags.upstream as string;

  const policies = loadPolicies(config.policyDir);
  const ledger = new Ledger(config.dbPath);
  const budget = new BudgetTracker();

  let proxyHandler: (req: Request) => Promise<Response>;
  let walletManager: any;

  if (flags.x402) {
    const { WalletManager } = await import("./wallet.ts");
    const { createX402ProxyHandler } = await import("./x402-proxy.ts");
    walletManager = new WalletManager(config.dbPath);
    proxyHandler = createX402ProxyHandler({
      upstreamUrl: config.upstreamUrl,
      policies,
      budget,
      ledger,
      walletManager,
      jwtSecret: config.jwtSecret,
    });
    console.log(`${C.magenta}${C.bold}  x402 payment protocol enabled${C.reset}`);
  } else {
    const { createProxyHandler } = await import("./proxy.ts");
    proxyHandler = createProxyHandler({
      upstreamUrl: config.upstreamUrl,
      policies,
      budget,
      ledger,
      jwtSecret: config.jwtSecret,
    });
  }

  const server = startServer({
    port: config.port,
    host: config.host,
    proxyHandler,
    budget,
    ledger,
    jwtSecret: config.jwtSecret,
    walletManager,
  });

  console.log(`${C.green}${C.bold}  ▸ Listening${C.reset}    http://${config.host}:${config.port}`);
  console.log(`${C.green}${C.bold}  ▸ Upstream${C.reset}     ${config.upstreamUrl}`);
  console.log(`${C.green}${C.bold}  ▸ Policies${C.reset}     ${policies.length} loaded`);
  console.log(`${C.green}${C.bold}  ▸ Database${C.reset}     ${config.dbPath}`);
  console.log(`${C.green}${C.bold}  ▸ Dashboard${C.reset}    http://${config.host}:${config.port}/dashboard`);
  console.log();

  process.on("SIGINT", () => {
    console.log(`\n${C.dim}Shutting down...${C.reset}`);
    server.stop();
    process.exit(0);
  });
}

async function cmdStatus(flags: Record<string, string | boolean>) {
  const port = flags.port ? parseInt(flags.port as string, 10) : 3456;
  const url = `http://localhost:${port}/api/dashboard`;

  try {
    const res = await fetch(url);
    if (!res.ok) die(`Server returned ${res.status}`);
    const data = await res.json() as any;

    console.log(`\n${C.bold}${C.cyan}  KYA Status${C.reset} ${C.dim}(port ${port})${C.reset}\n`);

    // Summary cards
    console.log(`  ${C.bold}Total Spend${C.reset}      ${C.green}${formatCents(data.totalSpentCents)}${C.reset}`);
    console.log(`  ${C.bold}Active Sessions${C.reset}  ${C.cyan}${data.activeSessions}${C.reset}`);
    console.log(`  ${C.bold}Total Calls${C.reset}      ${data.totalCalls}`);
    console.log(`  ${C.bold}Blocked Calls${C.reset}    ${data.blockedCalls > 0 ? C.red : ""}${data.blockedCalls}${C.reset}`);

    // Agent breakdown
    if (data.agents?.length > 0) {
      console.log(`\n  ${C.bold}${C.cyan}Agents${C.reset}`);
      console.log(`  ${C.dim}${"─".repeat(56)}${C.reset}`);
      for (const a of data.agents) {
        const blocked = a.blockedCalls > 0 ? `${C.red}${a.blockedCalls} blocked${C.reset}` : `${C.green}0 blocked${C.reset}`;
        console.log(
          `  ${C.bold}${a.agentId.padEnd(20)}${C.reset} ${formatCents(a.totalSpentCents).padStart(8)}  ${String(a.callCount).padStart(4)} calls  ${blocked}`,
        );
      }
    }

    // Recent calls
    if (data.recentCalls?.length > 0) {
      console.log(`\n  ${C.bold}${C.cyan}Recent Calls${C.reset}`);
      console.log(`  ${C.dim}${"─".repeat(56)}${C.reset}`);
      for (const call of data.recentCalls.slice(0, 8)) {
        const status = call.blocked
          ? `${C.red}✗ ${call.reason || "blocked"}${C.reset}`
          : `${C.green}✓${C.reset}`;
        console.log(
          `  ${C.dim}${new Date(call.timestamp).toLocaleTimeString()}${C.reset}  ${call.agentId.padEnd(16)} ${call.toolName.padEnd(18)} ${formatCents(call.costCents).padStart(7)}  ${status}`,
        );
      }
    }

    console.log();
  } catch {
    die(`Cannot reach KYA server at localhost:${port}. Is it running?`);
  }
}

async function cmdTokenCreate(flags: Record<string, string | boolean>) {
  const agent = flags.agent as string;
  const owner = flags.owner as string;
  if (!agent || !owner || agent === true || owner === true) {
    die("Usage: kya token create --agent NAME --owner EMAIL");
  }

  const port = flags.port ? parseInt(flags.port as string, 10) : 3456;

  try {
    const res = await fetch(`http://localhost:${port}/api/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agent, owner }),
    });
    const data = await res.json() as any;
    if (data.error) die(data.error);
    console.log(`\n${C.bold}${C.cyan}  Agent Token Created${C.reset}\n`);
    console.log(`  ${C.bold}Agent${C.reset}   ${agent}`);
    console.log(`  ${C.bold}Owner${C.reset}   ${owner}`);
    console.log(`  ${C.bold}Token${C.reset}   ${C.green}${data.token}${C.reset}\n`);
  } catch {
    die(`Cannot reach KYA server at localhost:${port}. Is it running?`);
  }
}

async function cmdWalletCreate(flags: Record<string, string | boolean>) {
  const agent = flags.agent as string;
  const balance = flags.balance as string;
  if (!agent || agent === true || !balance) {
    die("Usage: kya wallet create --agent NAME --balance 1000");
  }

  const port = flags.port ? parseInt(flags.port as string, 10) : 3456;

  try {
    const res = await fetch(`http://localhost:${port}/api/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agent, initialBalance: parseInt(balance, 10) }),
    });
    const data = await res.json() as any;
    if (data.error) die(data.error);
    console.log(`\n${C.bold}${C.cyan}  Wallet Created${C.reset}\n`);
    console.log(`  ${C.bold}Agent${C.reset}     ${agent}`);
    console.log(`  ${C.bold}Address${C.reset}   ${data.address}`);
    console.log(`  ${C.bold}Balance${C.reset}   ${C.green}${formatCents(data.balanceCents)}${C.reset}\n`);
  } catch {
    die(`Cannot reach KYA server at localhost:${port}. Is it running?`);
  }
}

async function cmdWalletList(flags: Record<string, string | boolean>) {
  const port = flags.port ? parseInt(flags.port as string, 10) : 3456;

  try {
    const res = await fetch(`http://localhost:${port}/api/wallets`);
    const wallets = await res.json() as any[];
    if (!Array.isArray(wallets) || wallets.length === 0) {
      console.log(`\n${C.dim}  No wallets found.${C.reset}\n`);
      return;
    }

    console.log(`\n${C.bold}${C.cyan}  Wallets${C.reset}\n`);
    console.log(
      `  ${C.dim}${"Agent".padEnd(20)} ${"Address".padEnd(16)} ${"Balance".padStart(10)} ${"Initial".padStart(10)}${C.reset}`,
    );
    console.log(`  ${C.dim}${"─".repeat(60)}${C.reset}`);

    for (const w of wallets) {
      const pct = w.initialBalanceCents > 0 ? w.balanceCents / w.initialBalanceCents : 0;
      const color = pct > 0.5 ? C.green : pct > 0.2 ? C.yellow : C.red;
      console.log(
        `  ${w.agentId.padEnd(20)} ${(w.address?.slice(0, 14) + "..").padEnd(16)} ${color}${formatCents(w.balanceCents).padStart(10)}${C.reset} ${formatCents(w.initialBalanceCents).padStart(10)}`,
      );
    }
    console.log();
  } catch {
    die(`Cannot reach KYA server at localhost:${port}. Is it running?`);
  }
}

async function cmdWalletFund(flags: Record<string, string | boolean>) {
  const agent = flags.agent as string;
  const amount = flags.amount as string;
  if (!agent || agent === true || !amount) {
    die("Usage: kya wallet fund --agent NAME --amount 500");
  }

  const port = flags.port ? parseInt(flags.port as string, 10) : 3456;

  try {
    const res = await fetch(`http://localhost:${port}/api/wallets/${encodeURIComponent(agent)}/credit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: parseInt(amount, 10) }),
    });
    const data = await res.json() as any;
    if (data.error) die(data.error);
    console.log(`\n${C.bold}${C.cyan}  Wallet Funded${C.reset}\n`);
    console.log(`  ${C.bold}Agent${C.reset}       ${agent}`);
    console.log(`  ${C.bold}Added${C.reset}       ${C.green}${formatCents(parseInt(amount, 10))}${C.reset}`);
    console.log(`  ${C.bold}New Balance${C.reset} ${C.green}${formatCents(data.newBalance)}${C.reset}\n`);
  } catch {
    die(`Cannot reach KYA server at localhost:${port}. Is it running?`);
  }
}

async function cmdDemo(flags: Record<string, string | boolean>) {
  banner();
  if (flags.x402) {
    console.log(`${C.dim}  Starting x402 payment demo...${C.reset}\n`);
    await import("../demo/run-demo-x402.ts");
  } else {
    console.log(`${C.dim}  Starting standard demo...${C.reset}\n`);
    await import("../demo/run-demo.ts");
  }
}

function cmdHelp() {
  banner();
  console.log(`${C.bold}USAGE${C.reset}`);
  console.log(`  ${C.cyan}kya${C.reset} <command> [options]\n`);

  console.log(`${C.bold}COMMANDS${C.reset}`);
  console.log(`  ${C.green}init${C.reset}                          Initialize KYA in current directory`);
  console.log(`  ${C.green}start${C.reset}                         Start the KYA proxy server`);
  console.log(`    ${C.dim}--port <port>${C.reset}                  Port to listen on (default: 3456)`);
  console.log(`    ${C.dim}--upstream <url>${C.reset}               Upstream MCP server URL`);
  console.log(`    ${C.dim}--x402${C.reset}                        Enable x402 payment protocol`);
  console.log(`  ${C.green}status${C.reset}                        Show proxy status and stats`);
  console.log(`    ${C.dim}--port <port>${C.reset}                  KYA port to query (default: 3456)`);
  console.log(`  ${C.green}token create${C.reset}                   Create an agent JWT token`);
  console.log(`    ${C.dim}--agent <name>${C.reset}                 Agent identifier`);
  console.log(`    ${C.dim}--owner <email>${C.reset}                Token owner email`);
  console.log(`  ${C.green}wallet create${C.reset}                  Create a new agent wallet`);
  console.log(`    ${C.dim}--agent <name>${C.reset}                 Agent identifier`);
  console.log(`    ${C.dim}--balance <cents>${C.reset}              Initial balance in cents`);
  console.log(`  ${C.green}wallet list${C.reset}                    List all wallets`);
  console.log(`  ${C.green}wallet fund${C.reset}                    Add funds to a wallet`);
  console.log(`    ${C.dim}--agent <name>${C.reset}                 Agent identifier`);
  console.log(`    ${C.dim}--amount <cents>${C.reset}               Amount to add in cents`);
  console.log(`  ${C.green}demo${C.reset}                          Run the KYA demo`);
  console.log(`    ${C.dim}--x402${C.reset}                        Run x402 payment demo instead`);
  console.log(`  ${C.green}help${C.reset}                          Show this help message\n`);

  console.log(`${C.bold}EXAMPLES${C.reset}`);
  console.log(`  ${C.dim}$${C.reset} kya init`);
  console.log(`  ${C.dim}$${C.reset} kya start --port 8080 --upstream http://mcp.example.com/mcp`);
  console.log(`  ${C.dim}$${C.reset} kya start --x402`);
  console.log(`  ${C.dim}$${C.reset} kya status`);
  console.log(`  ${C.dim}$${C.reset} kya token create --agent my-bot --owner dev@example.com`);
  console.log(`  ${C.dim}$${C.reset} kya wallet create --agent my-bot --balance 1000`);
  console.log(`  ${C.dim}$${C.reset} kya wallet fund --agent my-bot --amount 500`);
  console.log(`  ${C.dim}$${C.reset} kya demo --x402\n`);
}

// ─── Router ─────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];
const flags = parseFlags(args);

switch (command) {
  case "init":
    await cmdInit();
    break;
  case "start":
    await cmdStart(flags);
    break;
  case "status":
    await cmdStatus(flags);
    break;
  case "token":
    if (subcommand === "create") {
      await cmdTokenCreate(flags);
    } else {
      die(`Unknown token command: ${subcommand || "(none)"}. Try: kya token create`);
    }
    break;
  case "wallet":
    if (subcommand === "create") {
      await cmdWalletCreate(flags);
    } else if (subcommand === "list") {
      await cmdWalletList(flags);
    } else if (subcommand === "fund") {
      await cmdWalletFund(flags);
    } else {
      die(`Unknown wallet command: ${subcommand || "(none)"}. Try: kya wallet [create|list|fund]`);
    }
    break;
  case "demo":
    await cmdDemo(flags);
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    cmdHelp();
    break;
  default:
    die(`Unknown command: ${command}. Run ${C.cyan}kya help${C.reset} for usage.`);
}
