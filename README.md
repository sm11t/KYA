# KYA — Know Your Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-f472b6.svg)](https://bun.sh)

**The spending control layer for AI agents.** KYA is a proxy that sits between your agents and paid MCP tools, enforcing budgets, policies, and audit trails — so your agents can pay for things without going rogue.

---

## Why KYA?

AI agents are starting to spend real money. With 1,500+ paid MCP servers and protocols like [x402](https://x402.org) and [Stripe MPP](https://mpp.dev) enabling per-request micropayments, any agent can now autonomously pay for tools, data, and compute.

But there's no control layer on the **consumer side**:

- **No budgets** — agents spend without limits across any tool
- **No identity** — who authorized this agent?
- **No visibility** — spend is scattered across x402, MPP, API keys
- **No audit trail** — no unified record of what was spent, where, and why
- **No policy enforcement** — no way to say "this agent can use search but not email, max $5/session"

### The Market Gap

| Layer | Who's Building It | Examples |
|-------|------------------|---------|
| Payment rails | Protocol teams | x402 (Coinbase), MPP (Stripe/Tempo) |
| Tool monetization | Tool providers | AgentPay, Nevermined, MonetizedMCP |
| **Agent spending control** | **Nobody — this is KYA** | — |

x402 and MPP solve *how agents pay*. AgentPay solves *how tool providers charge*. KYA solves **how agent owners control what their agents spend**.

> x402/MPP are Visa and Mastercard. AgentPay is Shopify Payments. **KYA is the corporate card with spending limits.**

---

## Architecture

```
                          ┌─────────────────────────────────────┐
                          │            KYA Proxy                │
                          │                                     │
AI Agent ──── POST /mcp ──┤  ┌──────────┐   ┌──────────────┐   ├──── Upstream MCP
                          │  │  Policy   │──▶│    Budget     │   │     (x402 / MPP)
              JWT / ID ───┤  │  Engine   │   │   Tracker     │   │
                          │  └──────────┘   └──────────────┘   │
                          │        │               │            │
                          │  ┌─────▼───────────────▼──────┐    │
                          │  │     SQLite Audit Ledger     │    │
                          │  └────────────────────────────┘    │
                          │        │                            │
                          │  ┌─────▼────────┐  ┌───────────┐  │
                          │  │  Dashboard   │  │  Wallets   │  │
                          │  │  (HTML + API) │  │  (x402)    │  │
                          │  └──────────────┘  └───────────┘  │
                          └─────────────────────────────────────┘
```

---

## Quick Start

```bash
# Install
bun install

# Initialize KYA in your project
bun run src/cli.ts init

# Edit kya.config.json and policies, then start
bun run src/cli.ts start

# Or run with x402 payment support
bun run src/cli.ts start --x402
```

After `bun link`, use `kya` directly:

```bash
kya init
kya start --port 8080 --upstream http://mcp.example.com/mcp
kya status
kya token create --agent my-bot --owner dev@example.com
kya wallet create --agent my-bot --balance 1000
kya wallet list
kya wallet fund --agent my-bot --amount 500
```

---

## Features

### Policy Engine
Define per-agent rules as JSON files in `policies/`:

```json
{
  "agent": "coding-agent",
  "sessionBudget": 500,
  "perCallMax": 50,
  "allowedTools": ["web_search", "code_review"],
  "blockedTools": ["send_email", "transfer_funds"],
  "rateLimit": { "maxCallsPerMinute": 30 },
  "alertThresholds": [0.5, 0.8, 0.95]
}
```

- **Allow/block lists** — control which tools each agent can use
- **Session budgets** — cap total spend per session (in cents)
- **Per-call limits** — prevent any single expensive call
- **Rate limiting** — throttle calls per minute
- **Alert thresholds** — get warned at 50%, 80%, 95% of budget

### Budget Enforcement
Real-time, in-memory budget tracking with pre-authorization. Budget is reserved *before* the upstream call and refunded on failure — preventing concurrent overspend race conditions.

### x402 Payment Protocol
Full support for HTTP 402 payment challenges:
- Parses `X-Payment-*` headers from upstream
- Validates price against policy before paying
- Manages per-agent wallets with debit/credit
- Creates payment receipts and retries with proof

### Agent Identity
JWT-based authentication for agents:
- Create tokens with `kya token create`
- Attach via `Authorization: Bearer <token>` or `X-Agent-Id` header
- Policies resolve by agent ID with fallback to `default`

### Audit Ledger
Every tool call is logged to SQLite — allowed or blocked:
- Session ID, agent ID, tool name, cost, timestamp
- Block reason (if applicable)
- Upstream latency
- Queryable via API or dashboard

### Web Dashboard
Live HTML dashboard at `/dashboard` with auto-refresh:
- Total spend, active sessions, call counts
- Per-agent breakdown with blocked call tracking
- Recent call log with color-coded status
- Wallet balances (when x402 enabled)

---

## Demos

### Standard Demo
Starts a mock MCP upstream, KYA proxy, and simulates multi-agent traffic:

```bash
kya demo
# or: bun run demo
```

Watch agents hit budget limits, get blocked by policies, and trigger alert thresholds — all visible on the live dashboard.

### x402 Payment Demo
Demonstrates the full payment protocol flow with wallets:

```bash
kya demo --x402
# or: bun run demo:x402
```

Creates wallets for `research-bot` ($10) and `x402-coder` ($2.50), simulates paid tool calls, and shows wallet drain in real time.

---

## API Reference

### Proxy
| Method | Path | Description |
|--------|------|-------------|
| POST | `/mcp` | Forward MCP JSON-RPC to upstream (with policy/budget checks) |

### Dashboard
| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard` | HTML dashboard (auto-refreshes) |
| GET | `/api/dashboard` | Dashboard data as JSON |

### Agents
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | All agents breakdown |
| GET | `/api/agents/:id` | Agent details + call history |

### Tokens
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tokens` | Create JWT token (`{agentId, owner, permissions}`) |

### Wallets (x402)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/wallets` | List all wallets |
| GET | `/api/wallets/:id` | Get wallet by agent |
| POST | `/api/wallets` | Create wallet (`{agentId, initialBalance}`) |
| POST | `/api/wallets/:id/credit` | Add funds (`{amount}`) |
| GET | `/api/wallets/:id/transactions` | Transaction history |

### System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/status` | Active sessions, total spend, recent calls |
| GET | `/sessions/:id` | Session details + calls |

---

## Policy Reference

Policy files are JSON in `policies/`. The `agent` field matches the agent ID from JWT or `X-Agent-Id` header. A `default` policy is used as fallback.

| Field | Type | Description |
|-------|------|-------------|
| `agent` | string | Agent identifier (must match agent ID) |
| `sessionBudget` | number | Max spend per session in cents |
| `perCallMax` | number | Max cost per single tool call in cents |
| `allowedTools` | string[] | Allowlist of tools (empty = allow all) |
| `blockedTools` | string[] | Blocklist of tools (checked first) |
| `rateLimit.maxCallsPerMinute` | number | Max tool calls per rolling minute |
| `alertThresholds` | number[] | Fractions of budget that trigger alerts (e.g. `[0.5, 0.8, 0.95]`) |

---

## Configuration

KYA loads configuration with this priority: **defaults < `kya.config.json` < environment variables**.

### kya.config.json

```json
{
  "port": 3456,
  "host": "localhost",
  "upstream": "http://localhost:4001/mcp",
  "policyDir": "./policies",
  "dbPath": "./kya.sqlite",
  "jwtSecret": "change-me",
  "x402": false
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3456 | Server port |
| `HOST` | localhost | Server hostname |
| `UPSTREAM_MCP_URL` | http://localhost:4001/mcp | Upstream MCP server |
| `POLICY_DIR` | ./policies | Path to policy JSON files |
| `DB_PATH` | ./kya.sqlite | SQLite database path |
| `JWT_SECRET` | change-me-to-a-random-secret | Secret for signing JWTs |

---

## Project Structure

```
src/
├── cli.ts            # CLI entry point (kya command)
├── index.ts          # Programmatic entry point
├── config.ts         # Config loading (file + env)
├── server.ts         # HTTP server + REST API
├── proxy.ts          # Standard MCP proxy handler
├── x402-proxy.ts     # x402 payment protocol proxy
├── policy.ts         # Policy engine
├── budget.ts         # In-memory budget tracker
├── ledger.ts         # SQLite audit ledger
├── identity.ts       # JWT agent authentication
├── wallet.ts         # x402 wallet management
├── x402.ts           # x402 protocol helpers
├── dashboard.ts      # HTML dashboard renderer
├── dashboard-data.ts # Dashboard data aggregation
└── types.ts          # Shared TypeScript types
policies/             # Policy JSON files
demo/                 # Demo orchestrators + mock servers
test/                 # Test suite (bun:test)
```

---

## Tech Stack

- **Runtime**: [Bun](https://bun.sh) — fast TypeScript runtime with built-in SQLite, test runner, and HTTP server
- **Auth**: [jose](https://github.com/panva/jose) — JWT signing and verification
- **Database**: SQLite (via Bun's built-in driver) — audit ledger + wallet storage
- **Zero external frameworks** — no Express, no Fastify, no commander. Pure Bun built-ins.

---

## Roadmap

### Built
- [x] MCP proxy with JSON-RPC interception
- [x] Policy engine (allow/block, budgets, rate limits)
- [x] Real-time budget enforcement with pre-authorization
- [x] SQLite audit ledger
- [x] Web dashboard with live refresh
- [x] JWT agent identity
- [x] x402 payment protocol support
- [x] Wallet management (create, debit, credit, transactions)
- [x] CLI (`kya` command)

### Next
- [ ] Real on-chain wallet integration via [viem](https://viem.sh)
- [ ] Stripe MPP session support
- [ ] Multi-protocol spend aggregation (x402 + MPP + API key costs)
- [ ] Hosted cloud version with team management
- [ ] Webhook alerts (Slack, email, PagerDuty)
- [ ] Policy-as-code (OPA/Rego integration)

---

## Testing

```bash
bun test
```

Full test suite covering policy engine, budget tracking, proxy handlers, JWT auth, wallet management, x402 protocol, dashboard, and CLI.

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Write tests for your changes
4. Ensure all tests pass (`bun test`)
5. Submit a pull request

---

## License

MIT
