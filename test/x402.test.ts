import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { parseX402Challenge, createPaymentReceipt, attachPaymentProof } from "../src/x402.ts";
import { WalletManager } from "../src/wallet.ts";
import { Ledger } from "../src/ledger.ts";
import { BudgetTracker } from "../src/budget.ts";
import { createX402ProxyHandler } from "../src/x402-proxy.ts";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("x402 protocol", () => {
  describe("parseX402Challenge", () => {
    it("parses a valid 402 response", () => {
      const response = new Response("Payment required", {
        status: 402,
        headers: {
          "X-Payment-Price": "100",
          "X-Payment-Currency": "USDC",
          "X-Payment-Chain": "base",
          "X-Payment-Recipient": "0xabc123",
          "X-Payment-Description": "Premium tool",
          "X-Payment-Expires": "9999999999",
        },
      });

      const challenge = parseX402Challenge(response);
      expect(challenge).not.toBeNull();
      expect(challenge!.price).toBe(100);
      expect(challenge!.currency).toBe("USDC");
      expect(challenge!.chain).toBe("base");
      expect(challenge!.recipient).toBe("0xabc123");
      expect(challenge!.description).toBe("Premium tool");
      expect(challenge!.expiresAt).toBe(9999999999);
    });

    it("returns null for non-402 response", () => {
      const response = new Response("OK", { status: 200 });
      expect(parseX402Challenge(response)).toBeNull();
    });

    it("returns null when missing required headers", () => {
      const response = new Response("Payment required", {
        status: 402,
        headers: { "X-Payment-Currency": "USDC" },
      });
      expect(parseX402Challenge(response)).toBeNull();
    });

    it("uses defaults for optional headers", () => {
      const response = new Response("Payment required", {
        status: 402,
        headers: {
          "X-Payment-Price": "50",
          "X-Payment-Recipient": "0xdef456",
        },
      });
      const challenge = parseX402Challenge(response);
      expect(challenge).not.toBeNull();
      expect(challenge!.currency).toBe("USDC");
      expect(challenge!.chain).toBe("base");
      expect(challenge!.description).toBeUndefined();
      expect(challenge!.expiresAt).toBeUndefined();
    });
  });

  describe("createPaymentReceipt", () => {
    it("creates a receipt from challenge and wallet", () => {
      const challenge = { price: 50, currency: "USDC", chain: "base", recipient: "0xabc" };
      const wallet = { agentId: "test", balanceCents: 1000, initialBalanceCents: 1000, address: "0xpayer123" };

      const receipt = createPaymentReceipt(challenge, wallet);
      expect(receipt.txHash).toMatch(/^0x[0-9a-f]{32}$/);
      expect(receipt.payer).toBe("0xpayer123");
      expect(receipt.amount).toBe(50);
      expect(receipt.currency).toBe("USDC");
      expect(receipt.timestamp).toBeGreaterThan(0);
    });
  });

  describe("attachPaymentProof", () => {
    it("attaches payment headers to request", () => {
      const receipt = {
        txHash: "0xabc123",
        payer: "0xpayer",
        amount: 100,
        currency: "USDC",
        timestamp: 1234567890,
      };

      const original = new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true }),
      });

      const modified = attachPaymentProof(original, receipt);
      expect(modified.headers.get("X-Payment-TxHash")).toBe("0xabc123");
      expect(modified.headers.get("X-Payment-Payer")).toBe("0xpayer");
      expect(modified.headers.get("X-Payment-Amount")).toBe("100");
      expect(modified.headers.get("X-Payment-Currency")).toBe("USDC");
      expect(modified.headers.get("X-Payment-Timestamp")).toBe("1234567890");
      // Original headers preserved
      expect(modified.headers.get("Content-Type")).toBe("application/json");
    });
  });
});

describe("x402 proxy full flow", () => {
  let walletManager: WalletManager;
  let ledger: Ledger;
  let budget: BudgetTracker;
  let tmpDir: string;
  let mockServer: ReturnType<typeof Bun.serve>;
  let handler: (req: Request) => Promise<Response>;

  const MOCK_PORT = 14402;
  const RECIPIENT = "0xrecipient";

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kya-x402-test-"));
    const dbPath = join(tmpDir, "test.sqlite");
    ledger = new Ledger(dbPath);
    budget = new BudgetTracker();
    walletManager = new WalletManager(dbPath);

    // Mock upstream that returns 402 for "paid_tool" and normal for "free_tool"
    mockServer = Bun.serve({
      port: MOCK_PORT,
      async fetch(req) {
        const body = await req.json();
        const { method, params, id } = body;

        if (method === "tools/call") {
          const toolName = params?.name;

          if (toolName === "free_tool") {
            return Response.json({
              jsonrpc: "2.0",
              result: { content: [{ type: "text", text: "free result" }] },
              id,
            });
          }

          if (toolName === "paid_tool") {
            const txHash = req.headers.get("X-Payment-TxHash");
            if (txHash) {
              return Response.json({
                jsonrpc: "2.0",
                result: { content: [{ type: "text", text: "paid result" }] },
                id,
              });
            }
            return new Response(
              JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Payment required" }, id }),
              {
                status: 402,
                headers: {
                  "Content-Type": "application/json",
                  "X-Payment-Price": "50",
                  "X-Payment-Currency": "USDC",
                  "X-Payment-Chain": "base",
                  "X-Payment-Recipient": RECIPIENT,
                },
              },
            );
          }

          if (toolName === "expensive_tool") {
            const txHash = req.headers.get("X-Payment-TxHash");
            if (txHash) {
              return Response.json({
                jsonrpc: "2.0",
                result: { content: [{ type: "text", text: "expensive result" }] },
                id,
              });
            }
            return new Response(
              JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Payment required" }, id }),
              {
                status: 402,
                headers: {
                  "Content-Type": "application/json",
                  "X-Payment-Price": "500",
                  "X-Payment-Currency": "USDC",
                  "X-Payment-Chain": "base",
                  "X-Payment-Recipient": RECIPIENT,
                },
              },
            );
          }
        }

        return Response.json({ jsonrpc: "2.0", error: { code: -32601, message: "Not found" }, id: body.id });
      },
    });

    handler = createX402ProxyHandler({
      upstreamUrl: `http://localhost:${MOCK_PORT}`,
      policies: [
        {
          agent: "test-agent",
          sessionBudget: 1000,
          perCallMax: 200,
          allowedTools: [],
          blockedTools: [],
          rateLimit: { maxCallsPerMinute: 60 },
          alertThresholds: [0.5, 0.8],
        },
        {
          agent: "budget-agent",
          sessionBudget: 100,
          perCallMax: 40,
          allowedTools: [],
          blockedTools: [],
          rateLimit: { maxCallsPerMinute: 60 },
          alertThresholds: [],
        },
      ],
      budget,
      ledger,
      walletManager,
      jwtSecret: "test-secret",
    });
  });

  afterEach(() => {
    mockServer.stop();
    walletManager.close();
    ledger.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRequest(agentId: string, toolName: string, sessionId: string) {
    return new Request(`http://localhost:${MOCK_PORT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Id": agentId,
        "X-Session-Id": sessionId,
        "X-Tool-Cost": "0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: toolName, arguments: {} },
        id: 1,
      }),
    });
  }

  it("full flow: 402 → parse → pay → retry → success", async () => {
    walletManager.createWallet("test-agent", 1000);

    const res = await handler(makeRequest("test-agent", "paid_tool", "sess-1"));
    const body = await res.json();

    expect(body.result).toBeDefined();
    expect(body.result.content[0].text).toBe("paid result");

    // Wallet should be debited
    expect(walletManager.getBalance("test-agent")).toBe(950); // 1000 - 50
  });

  it("full flow: 402 → parse → budget exceeded → blocked", async () => {
    walletManager.createWallet("budget-agent", 10000);

    // budget-agent has perCallMax=40, but expensive_tool costs 500 via 402
    // Actually the 402 price is 500 which exceeds perCallMax of 40
    const res = await handler(makeRequest("budget-agent", "expensive_tool", "sess-budget"));
    const body = await res.json();

    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("x402 payment blocked");

    // Wallet should NOT be debited
    expect(walletManager.getBalance("budget-agent")).toBe(10000);
  });

  it("full flow: 402 → parse → insufficient wallet balance → blocked", async () => {
    walletManager.createWallet("test-agent", 20); // Only 20¢, paid_tool costs 50¢

    const res = await handler(makeRequest("test-agent", "paid_tool", "sess-broke"));
    const body = await res.json();

    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("Wallet debit failed");

    // Balance unchanged
    expect(walletManager.getBalance("test-agent")).toBe(20);
  });

  it("non-402 responses pass through normally", async () => {
    walletManager.createWallet("test-agent", 1000);

    const res = await handler(makeRequest("test-agent", "free_tool", "sess-free"));
    const body = await res.json();

    expect(body.result).toBeDefined();
    expect(body.result.content[0].text).toBe("free result");

    // No wallet debit for free tools
    expect(walletManager.getBalance("test-agent")).toBe(1000);
  });

  it("blocks when agent has no wallet", async () => {
    // Don't create a wallet for this agent
    const res = await handler(makeRequest("test-agent", "paid_tool", "sess-nowallet"));
    const body = await res.json();

    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("No wallet found");
  });

  it("multiple payments drain wallet correctly", async () => {
    walletManager.createWallet("test-agent", 150); // 150¢

    // First call: 50¢ → balance 100¢
    await handler(makeRequest("test-agent", "paid_tool", "sess-drain"));
    expect(walletManager.getBalance("test-agent")).toBe(100);

    // Second call: 50¢ → balance 50¢
    await handler(makeRequest("test-agent", "paid_tool", "sess-drain"));
    expect(walletManager.getBalance("test-agent")).toBe(50);

    // Third call: 50¢ → balance 0¢
    await handler(makeRequest("test-agent", "paid_tool", "sess-drain"));
    expect(walletManager.getBalance("test-agent")).toBe(0);

    // Fourth call: insufficient funds
    const res = await handler(makeRequest("test-agent", "paid_tool", "sess-drain"));
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("Insufficient balance");
  });
});
