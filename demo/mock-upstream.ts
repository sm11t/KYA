// Mock MCP upstream tool server for demo purposes
// Responds to JSON-RPC 2.0 requests with realistic fake results

const TOOLS = [
  { name: "web_search", description: "Search the web for information", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "code_review", description: "Review code for bugs and improvements", inputSchema: { type: "object", properties: { code: { type: "string" }, language: { type: "string" } }, required: ["code"] } },
  { name: "file_read", description: "Read contents of a file", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "database_query", description: "Execute a read-only database query", inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] } },
  { name: "send_email", description: "Send an email message", inputSchema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"] } },
  { name: "image_generate", description: "Generate an image from a text prompt", inputSchema: { type: "object", properties: { prompt: { type: "string" }, size: { type: "string" } }, required: ["prompt"] } },
  { name: "translate", description: "Translate text between languages", inputSchema: { type: "object", properties: { text: { type: "string" }, from: { type: "string" }, to: { type: "string" } }, required: ["text", "to"] } },
  { name: "summarize", description: "Summarize a block of text", inputSchema: { type: "object", properties: { text: { type: "string" }, maxLength: { type: "number" } }, required: ["text"] } },
];

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

const FAKE_RESULTS: Record<string, () => unknown> = {
  web_search: () => ({ results: [{ title: "Result 1", url: "https://example.com", snippet: "Relevant information found..." }, { title: "Result 2", url: "https://docs.example.com", snippet: "Additional context..." }] }),
  code_review: () => ({ issues: [{ line: 42, severity: "warning", message: "Consider using const instead of let" }], summary: "Code looks good overall. 1 minor suggestion." }),
  file_read: () => ({ content: "import { serve } from 'bun';\n\nconst app = serve({ port: 3000 });\nconsole.log('Server running');", lines: 4 }),
  database_query: () => ({ rows: [{ id: 1, name: "Alice", role: "admin" }, { id: 2, name: "Bob", role: "user" }], rowCount: 2 }),
  send_email: () => ({ messageId: `msg-${Date.now()}`, status: "sent" }),
  image_generate: () => ({ imageUrl: `https://images.example.com/${Date.now()}.png`, width: 1024, height: 1024 }),
  translate: () => ({ translated: "Bonjour le monde!", detectedLanguage: "en" }),
  summarize: () => ({ summary: "The text discusses key architectural decisions for building scalable systems, focusing on event-driven patterns and microservice boundaries.", wordCount: 18 }),
};

function randomLatency(): number {
  return Math.floor(Math.random() * 450) + 50; // 50-500ms
}

export function startMockUpstream(port = 4001) {
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
        return Response.json({ jsonrpc: "2.0", result: { tools: TOOLS }, id });
      }

      if (method === "tools/call") {
        const toolName = params?.name;
        const latency = randomLatency();
        await Bun.sleep(latency);

        const cost = TOOL_COSTS[toolName] ?? 1;
        const resultFn = FAKE_RESULTS[toolName];
        const result = resultFn ? resultFn() : { ok: true };

        console.log(`  [mock-upstream] ${toolName} → ${cost}¢ (${latency}ms)`);

        return Response.json({
          jsonrpc: "2.0",
          result: { content: [{ type: "text", text: JSON.stringify(result) }] },
          id,
        });
      }

      return Response.json({ jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id });
    },
  });

  console.log(`[mock-upstream] Fake MCP tool server on http://localhost:${port}/mcp`);
  return server;
}

// Allow running standalone
if (import.meta.main) {
  startMockUpstream();
}
