# KYA — Know Your Agent

The spending control layer for AI agents. KYA is a proxy that sits between your agents and paid MCP tools, enforcing budgets, policies, and audit trails — so your agents can pay for things without going rogue.

## The Problem

AI agents are starting to spend real money. With 1,500+ paid MCP servers and protocols like [x402](https://x402.org) and [Stripe MPP](https://mpp.dev) enabling per-request micropayments, any agent can now autonomously pay for tools, data, and compute.

But there's no control layer on the **consumer side**:

- **No budgets** — agents can spend without limits across any tool
- **No identity** — who authorized this agent? What's it allowed to do?
- **No cross-protocol visibility** — spend is scattered across x402, MPP, API keys
- **No audit trail** — no unified record of what was spent, where, and why
- **No policy enforcement** — no way to say "this agent can use search but not email, max $5/session"

### What Already Exists (And What Doesn't)

| Layer | Who's Building It | Examples |
|-------|------------------|---------|
| **Payment rails** | Protocol teams | x402 (Coinbase), MPP (Stripe/Tempo) |
| **Tool monetization** | Tool providers | AgentPay, Nevermined, MonetizedMCP |
| **Agent spending control** | **Nobody — this is KYA** | — |

x402 and MPP solve *how agents pay*. AgentPay and Nevermined solve *how tool providers charge*. KYA solves **how agent owners control what their agents spend**.

Think of it this way: x402/MPP are Visa and Mastercard. AgentPay is Shopify Payments. **KYA is the corporate card with spending limits.**

## How It Works

```
AI Agent ──▶ KYA Proxy ──▶ Paid MCP Tools (x402 / MPP / API key)
                │
          • Policy check (allowed? within budget?)
          • Price discovery (how much will this cost?)
          • Budget enforcement (block if over limit)
          • Audit logging (every call, every cent)
```

KYA intercepts MCP tool calls, checks them against your policies, enforces budgets in real-time, and logs everything to a local ledger. If a call would bust the budget or violate policy, it's blocked before any money moves.

## Quick Start

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env

# Start the proxy
bun run dev

# Run tests
bun test
```

## Define a Policy

```json
{
  "agent": "my-coding-agent",
  "sessionBudget": 500,
  "perCallMax": 50,
  "allowedTools": ["web_search", "code_review"],
  "blockedTools": ["send_email", "transfer_funds"],
  "rateLimit": { "maxCallsPerMinute": 30 },
  "alertThresholds": [0.5, 0.8, 0.95]
}
```

Then point your agent at `localhost:3456` instead of directly at MCP tools. KYA handles the rest.

## Architecture

```
src/
├── proxy.ts          # MCP proxy — intercepts listTools + callTool
├── budget.ts         # Budget tracker — per-session, per-tool, per-call
├── policy.ts         # Policy engine — parse and enforce JSON policies
├── ledger.ts         # SQLite audit ledger — every call logged
├── identity.ts       # Agent JWT tokens — identity + authorization
├── server.ts         # HTTP server + health/status endpoints
├── config.ts         # Configuration loading
└── types.ts          # Shared type definitions
policies/             # Policy JSON files
test/                 # Tests
```

## Roadmap

- [x] **Phase 1** — MCP proxy + policy engine + budget enforcement + audit ledger
- [ ] **Phase 2** — Web dashboard + agent identity (JWT) + multi-agent view
- [ ] **Phase 3** — x402 wallet integration + Stripe MPP sessions + fiat top-up

## Why?

The agentic economy needs a trust layer on the **consumer side**. Agents that spend money need guardrails — not just payment rails. KYA is that guardrail.

## License

MIT
