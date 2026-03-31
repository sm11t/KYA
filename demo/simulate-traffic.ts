// Traffic simulator — sends realistic agent traffic through the KYA proxy

const PROXY_URL = "http://localhost:3456/mcp";

const TOOL_COSTS: Record<string, number> = {
  web_search: 1,
  code_review: 25,
  file_read: 1,
  database_query: 5,
  send_email: 1,
  image_generate: 50,
  translate: 2,
  summarize: 3,
};

// ANSI colors
const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

const AGENT_COLORS: Record<string, string> = {
  "research-bot": C.cyan,
  "coding-agent": C.blue,
  "creative-bot": C.magenta,
};

interface CallResult {
  agent: string;
  tool: string;
  cost: number;
  blocked: boolean;
  reason?: string;
}

const results: CallResult[] = [];

async function callTool(agentId: string, sessionId: string, toolName: string): Promise<CallResult> {
  const cost = TOOL_COSTS[toolName] ?? 1;
  const color = AGENT_COLORS[agentId] || C.reset;

  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Id": agentId,
        "X-Session-Id": sessionId,
        "X-Tool-Cost": String(cost),
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
    const reason = body.error?.message;

    const status = blocked
      ? `${C.red}✗ BLOCKED${C.reset} ${C.dim}(${reason})${C.reset}`
      : `${C.green}✓${C.reset}`;

    console.log(`  ${color}${agentId}${C.reset} → ${toolName} (${cost}¢) ${status}`);

    const result = { agent: agentId, tool: toolName, cost, blocked, reason };
    results.push(result);
    return result;
  } catch (err) {
    console.log(`  ${color}${agentId}${C.reset} → ${toolName} (${cost}¢) ${C.red}✗ ERROR${C.reset}`);
    const result = { agent: agentId, tool: toolName, cost, blocked: true, reason: "connection error" };
    results.push(result);
    return result;
  }
}

// Agent 1: research-bot — steady stream of web_search and summarize
async function runResearchBot() {
  const session = `research-${Date.now()}`;
  const tools = ["web_search", "web_search", "summarize", "web_search", "summarize", "web_search", "web_search", "summarize", "web_search", "web_search", "summarize", "web_search", "web_search", "summarize", "web_search", "web_search", "summarize", "web_search", "summarize", "web_search", "web_search", "summarize", "web_search", "web_search", "summarize", "web_search", "summarize", "web_search", "web_search", "summarize"];

  for (const tool of tools) {
    await callTool("research-bot", session, tool);
    await Bun.sleep(400 + Math.random() * 200); // ~2 calls/sec
  }
}

// Agent 2: coding-agent — bursts of code_review/file_read, tries blocked send_email
async function runCodingAgent() {
  const session = `coding-${Date.now()}`;

  // Burst 1: file reads
  console.log(`\n${C.bold}${C.blue}  [coding-agent] Starting file analysis burst...${C.reset}`);
  for (let i = 0; i < 4; i++) {
    await callTool("coding-agent", session, "file_read");
    await Bun.sleep(100 + Math.random() * 100);
  }

  await Bun.sleep(1500); // pause between bursts

  // Burst 2: code reviews
  console.log(`  ${C.bold}${C.blue}[coding-agent] Running code reviews...${C.reset}`);
  for (let i = 0; i < 3; i++) {
    await callTool("coding-agent", session, "code_review");
    await Bun.sleep(200 + Math.random() * 300);
  }

  await Bun.sleep(1000);

  // Try blocked tool
  console.log(`  ${C.bold}${C.blue}[coding-agent] Attempting to send email...${C.reset}`);
  await callTool("coding-agent", session, "send_email");

  await Bun.sleep(500);

  // Try another blocked tool
  console.log(`  ${C.bold}${C.blue}[coding-agent] Attempting database_query (not in allowlist)...${C.reset}`);
  await callTool("coding-agent", session, "database_query");

  await Bun.sleep(1000);

  // Burst 3: more code work
  console.log(`  ${C.bold}${C.blue}[coding-agent] Final code review burst...${C.reset}`);
  for (let i = 0; i < 3; i++) {
    await callTool("coding-agent", session, "code_review");
    await Bun.sleep(300 + Math.random() * 200);
  }
}

// Agent 3: creative-bot — image_generate and translate, will hit budget ceiling
async function runCreativeBot() {
  const session = `creative-${Date.now()}`;

  // Start with some translates
  for (let i = 0; i < 3; i++) {
    await callTool("creative-bot", session, "translate");
    await Bun.sleep(300 + Math.random() * 200);
  }

  await Bun.sleep(800);

  // image_generate calls — 50¢ each, budget is 200¢, should get blocked after ~3
  // Spent so far: 3 translates × 2¢ = 6¢. Remaining: 194¢. Can afford 3 images (150¢), 4th blocked.
  console.log(`  ${C.bold}${C.magenta}[creative-bot] Generating images (50¢ each)...${C.reset}`);
  for (let i = 0; i < 6; i++) {
    await callTool("creative-bot", session, "image_generate");
    await Bun.sleep(600 + Math.random() * 400);
  }

  await Bun.sleep(500);

  // Try more translates after budget is exhausted
  console.log(`  ${C.bold}${C.magenta}[creative-bot] Trying more work after budget hit...${C.reset}`);
  for (let i = 0; i < 3; i++) {
    await callTool("creative-bot", session, "translate");
    await Bun.sleep(300);
  }
}

export async function simulateTraffic() {
  console.log(`\n${C.bold}═══════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  KYA Demo — Simulating Multi-Agent Traffic${C.reset}`);
  console.log(`${C.bold}═══════════════════════════════════════════════════════════${C.reset}\n`);
  console.log(`  ${C.cyan}research-bot${C.reset}  — web_search + summarize (generous budget)`);
  console.log(`  ${C.blue}coding-agent${C.reset}  — code work + blocked tools (policy enforced)`);
  console.log(`  ${C.magenta}creative-bot${C.reset}  — image_generate + translate (low budget)\n`);
  console.log(`${C.dim}  Sending requests to ${PROXY_URL}...${C.reset}\n`);

  // Run all three agents concurrently
  await Promise.all([
    runResearchBot(),
    runCodingAgent(),
    runCreativeBot(),
  ]);

  // Print summary
  const agents = ["research-bot", "coding-agent", "creative-bot"];
  console.log(`\n${C.bold}═══════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  Summary${C.reset}`);
  console.log(`${C.bold}═══════════════════════════════════════════════════════════${C.reset}\n`);

  for (const agent of agents) {
    const agentResults = results.filter((r) => r.agent === agent);
    const total = agentResults.length;
    const blocked = agentResults.filter((r) => r.blocked).length;
    const spent = agentResults.filter((r) => !r.blocked).reduce((s, r) => s + r.cost, 0);
    const color = AGENT_COLORS[agent];

    console.log(`  ${color}${agent}${C.reset}`);
    console.log(`    Calls: ${total}  |  Spent: ${spent}¢ ($${(spent / 100).toFixed(2)})  |  Blocked: ${blocked > 0 ? C.red + blocked + C.reset : "0"}`);
  }

  const totalCalls = results.length;
  const totalBlocked = results.filter((r) => r.blocked).length;
  const totalSpent = results.filter((r) => !r.blocked).reduce((s, r) => s + r.cost, 0);

  console.log(`\n  ${C.bold}Total:${C.reset} ${totalCalls} calls | ${totalSpent}¢ ($${(totalSpent / 100).toFixed(2)}) spent | ${totalBlocked} blocked\n`);
}

if (import.meta.main) {
  await simulateTraffic();
}
