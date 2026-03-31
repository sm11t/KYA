# KYA — Know Your Agent

A budget-enforcing MCP proxy that gives AI agents identity, spending controls, and audit trails — settled through Stripe.

## The Problem

When AI agents use paid MCP tools, there are zero guardrails:
- No identity — who is this agent? Who authorized it?
- No budgets — agents can spend without limits
- No price awareness — agents can't decide if a call is worth it
- No audit trail — no record of what was spent and why

## What KYA Does

KYA is a proxy that sits between any AI agent and paid MCP tools.

```
AI Agent ──▶ KYA Proxy ──▶ Paid MCP Tools
                │
          • Identity (agent tokens)
          • Budget enforcement
          • Price discovery
          • Spend tracking
          • Stripe settlement
```

### Features

- **Agent Identity Tokens** — JWT-based identity linking agents to human owners
- **Per-Session Budgets** — hard spending caps per session, per tool, per call
- **Policy Engine** — JSON policies defining what agents can and can't do
- **Price Discovery** — agents see tool costs before execution
- **Real-Time Dashboard** — live spending, per-tool breakdown, velocity tracking
- **Stripe Settlement** — pre-paid credits, metered usage, full audit log
- **Audit Trail** — every tool call logged with timestamp, cost, and agent identity

## Quick Start

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env

# Start the proxy
bun run dev

# Dashboard at http://localhost:3456/dashboard
```

## Architecture

```
packages/
├── proxy/          # MCP proxy server — intercepts and enforces
├── identity/       # Agent token issuance and verification
├── policy/         # Policy engine — budgets, allowlists, rate limits
├── dashboard/      # Real-time spend dashboard
├── settlement/     # Stripe integration — credits + metering
└── examples/       # Example MCP tools + agent configs
```

## Example Policy

```json
{
  "agentName": "my-coding-agent",
  "sessionBudgetCents": 500,
  "maxPerCallCents": 50,
  "allowedTools": ["search", "database_query"],
  "blockedTools": ["send_email", "transfer_funds"],
  "rateLimit": { "maxCallsPerMinute": 30 },
  "alertAt": [0.5, 0.8, 0.95]
}
```

## Why?

The agentic economy needs a trust layer. Stripe MPP handles settlement. x402 handles per-request payments. But neither solves identity, budgets, or audit at the agent-to-tool boundary. KYA fills that gap.

## License

MIT
