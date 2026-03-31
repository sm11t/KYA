// Mock MCP upstream that returns HTTP 402 challenges for paid tools
// Simulates the x402 payment protocol flow

const TOOLS = [
  { name: "premium_search", description: "Premium web search with deep results", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, price: 10 },
  { name: "deep_analysis", description: "Deep analysis of complex topics", inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] }, price: 100 },
  { name: "code_audit", description: "Security audit of code", inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] }, price: 50 },
];

const TOOL_PRICES: Record<string, number> = {
  premium_search: 10,
  deep_analysis: 100,
  code_audit: 50,
};

const FAKE_RESULTS: Record<string, () => unknown> = {
  premium_search: () => ({ results: [{ title: "Premium Result 1", url: "https://premium.example.com", snippet: "High-quality curated result with deep web data..." }, { title: "Premium Result 2", url: "https://research.example.com", snippet: "Academic sources and verified information..." }], quality: "premium" }),
  deep_analysis: () => ({ analysis: "Comprehensive multi-factor analysis complete. Key findings: 3 primary risk vectors identified, 2 optimization opportunities, overall confidence: 94%.", factors: 12, confidence: 0.94 }),
  code_audit: () => ({ vulnerabilities: [{ severity: "medium", type: "SQL injection", line: 42, file: "db.ts" }], score: 85, recommendation: "Fix parameterized query on line 42" }),
};

const RECIPIENT_ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18";

function randomLatency(): number {
  return Math.floor(Math.random() * 300) + 100;
}

export function startMockX402Upstream(port = 4002) {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "POST" || url.pathname !== "/mcp") {
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }

      const body = await req.json();
      const { method, params, id } = body;

      if (method === "tools/list") {
        return Response.json({
          jsonrpc: "2.0",
          result: { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) },
          id,
        });
      }

      if (method === "tools/call") {
        const toolName = params?.name as string;
        const price = TOOL_PRICES[toolName];

        if (!price) {
          return Response.json({
            jsonrpc: "2.0",
            error: { code: -32601, message: `Unknown tool: ${toolName}` },
            id,
          });
        }

        // Check for payment proof
        const txHash = req.headers.get("X-Payment-TxHash");
        const payer = req.headers.get("X-Payment-Payer");
        const paymentAmount = req.headers.get("X-Payment-Amount");

        if (txHash && payer && paymentAmount) {
          // Payment provided — verify amount and deliver result
          const paidAmount = parseInt(paymentAmount, 10);
          if (paidAmount < price) {
            return new Response(
              JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: `Insufficient payment: paid ${paidAmount}¢, need ${price}¢` }, id }),
              { status: 402, headers: { "Content-Type": "application/json" } },
            );
          }

          const latency = randomLatency();
          await Bun.sleep(latency);

          const resultFn = FAKE_RESULTS[toolName];
          const result = resultFn ? resultFn() : { ok: true };

          console.log(`  [mock-x402] ${toolName} → PAID ${price}¢ by ${payer.slice(0, 10)}... (${latency}ms)`);

          return Response.json({
            jsonrpc: "2.0",
            result: { content: [{ type: "text", text: JSON.stringify(result) }] },
            id,
          });
        }

        // No payment — return 402 challenge
        console.log(`  [mock-x402] ${toolName} → 402 Payment Required (${price}¢)`);

        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Payment required" },
            id,
          }),
          {
            status: 402,
            headers: {
              "Content-Type": "application/json",
              "X-Payment-Price": String(price),
              "X-Payment-Currency": "USDC",
              "X-Payment-Chain": "base",
              "X-Payment-Recipient": RECIPIENT_ADDRESS,
              "X-Payment-Description": `Payment for ${toolName}`,
              "X-Payment-Expires": String(Date.now() + 300_000),
            },
          },
        );
      }

      return Response.json({ jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id });
    },
  });

  console.log(`[mock-x402] x402 MCP tool server on http://localhost:${port}/mcp`);
  return server;
}

if (import.meta.main) {
  startMockX402Upstream();
}
