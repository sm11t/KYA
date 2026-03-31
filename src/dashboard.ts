import type { DashboardData } from "./dashboard-data.ts";

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

export function renderDashboard(data: DashboardData): string {
  const agentRows = data.agentBreakdown
    .map(
      (a) => `
      <tr>
        <td>${escapeHtml(a.agentId)}</td>
        <td>${formatCents(a.totalSpent)}</td>
        <td>${a.callCount}</td>
        <td>${a.blockedCount}</td>
      </tr>`,
    )
    .join("");

  const callRows = data.recentCalls
    .map(
      (c) => `
      <tr class="${c.blocked ? "blocked" : ""}">
        <td title="${escapeHtml(c.sessionId)}">${escapeHtml(c.sessionId.slice(0, 12))}...</td>
        <td>${escapeHtml(c.agentId)}</td>
        <td>${escapeHtml(c.toolName)}</td>
        <td>${formatCents(c.costCents)}</td>
        <td>${c.blocked ? '<span class="badge-blocked">BLOCKED</span>' : '<span class="badge-ok">OK</span>'}</td>
        <td>${formatTimestamp(c.timestamp)}</td>
      </tr>`,
    )
    .join("");

  const sessionRows = data.sessions
    .map(
      (s) => `
      <tr>
        <td title="${escapeHtml(s.sessionId)}">${escapeHtml(s.sessionId.slice(0, 16))}...</td>
        <td>${escapeHtml(s.agentId)}</td>
        <td>${formatCents(s.totalSpentCents)}</td>
        <td>${s.callCount}</td>
        <td>${s.topTools.map((t) => `${escapeHtml(t.tool)} (${formatCents(t.spend)})`).join(", ") || "—"}</td>
      </tr>`,
    )
    .join("");

  const walletRows = data.wallets
    .map((w) => {
      const pct = w.initialBalanceCents > 0 ? w.balanceCents / w.initialBalanceCents : 0;
      const colorClass = pct > 0.5 ? "wallet-green" : pct > 0.2 ? "wallet-yellow" : "wallet-red";
      return `
      <tr>
        <td>${escapeHtml(w.agentId)}</td>
        <td class="${colorClass}">${formatCents(w.balanceCents)}</td>
        <td>${formatCents(w.initialBalanceCents)}</td>
        <td title="${escapeHtml(w.address)}">${escapeHtml(w.address.slice(0, 14))}...</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="5">
  <title>KYA — Know Your Agent</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      background: #0d1117;
      color: #c9d1d9;
      padding: 24px;
      line-height: 1.5;
    }
    header {
      display: flex;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 32px;
      border-bottom: 1px solid #21262d;
      padding-bottom: 16px;
    }
    header h1 {
      font-size: 22px;
      color: #58a6ff;
      font-weight: 600;
    }
    header .version {
      font-size: 13px;
      color: #484f58;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .card {
      background: #161b22;
      border: 1px solid #21262d;
      border-radius: 8px;
      padding: 20px;
    }
    .card .label {
      font-size: 12px;
      color: #8b949e;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .card .value {
      font-size: 28px;
      font-weight: 700;
      color: #f0f6fc;
      margin-top: 4px;
    }
    .card .value.spend { color: #3fb950; }
    .card .value.blocked { color: #f85149; }
    section {
      margin-bottom: 32px;
    }
    section h2 {
      font-size: 16px;
      color: #58a6ff;
      margin-bottom: 12px;
      font-weight: 600;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      text-align: left;
      padding: 8px 12px;
      background: #161b22;
      color: #8b949e;
      font-weight: 500;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #21262d;
    }
    td {
      padding: 8px 12px;
      border-bottom: 1px solid #21262d;
    }
    tr:hover { background: #161b22; }
    tr.blocked { opacity: 0.8; }
    .badge-ok {
      background: #238636;
      color: #fff;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-blocked {
      background: #da3633;
      color: #fff;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }
    .empty {
      color: #484f58;
      font-style: italic;
      padding: 16px 0;
    }
    .wallet-green { color: #3fb950; font-weight: 600; }
    .wallet-yellow { color: #d29922; font-weight: 600; }
    .wallet-red { color: #f85149; font-weight: 600; }
  </style>
</head>
<body>
  <header>
    <h1>KYA — Know Your Agent</h1>
    <span class="version">v0.2.0</span>
  </header>

  <div class="cards">
    <div class="card">
      <div class="label">Total Spend</div>
      <div class="value spend">${formatCents(data.totalSpentCents)}</div>
    </div>
    <div class="card">
      <div class="label">Active Sessions</div>
      <div class="value">${data.activeSessions}</div>
    </div>
    <div class="card">
      <div class="label">Total Calls</div>
      <div class="value">${data.totalCalls}</div>
    </div>
    <div class="card">
      <div class="label">Blocked Calls</div>
      <div class="value blocked">${data.blockedCalls}</div>
    </div>
  </div>

  ${
      data.wallets.length > 0
        ? `<div class="cards">
    <div class="card">
      <div class="label">Total Wallet Balance</div>
      <div class="value spend">${formatCents(data.totalWalletBalance)}</div>
    </div>
  </div>

  <section>
    <h2>Wallets</h2>
    <table>
      <thead><tr><th>Agent</th><th>Balance</th><th>Initial</th><th>Address</th></tr></thead>
      <tbody>${walletRows}</tbody>
    </table>
  </section>`
        : ""
    }

  <section>
    <h2>Agent Breakdown</h2>
    ${
      data.agentBreakdown.length > 0
        ? `<table>
      <thead><tr><th>Agent</th><th>Spend</th><th>Calls</th><th>Blocked</th></tr></thead>
      <tbody>${agentRows}</tbody>
    </table>`
        : '<p class="empty">No agent data yet.</p>'
    }
  </section>

  <section>
    <h2>Recent Calls</h2>
    ${
      data.recentCalls.length > 0
        ? `<table>
      <thead><tr><th>Session</th><th>Agent</th><th>Tool</th><th>Cost</th><th>Status</th><th>Timestamp</th></tr></thead>
      <tbody>${callRows}</tbody>
    </table>`
        : '<p class="empty">No calls recorded yet.</p>'
    }
  </section>

  <section>
    <h2>Active Sessions</h2>
    ${
      data.sessions.length > 0
        ? `<table>
      <thead><tr><th>Session</th><th>Agent</th><th>Spend</th><th>Calls</th><th>Top Tools</th></tr></thead>
      <tbody>${sessionRows}</tbody>
    </table>`
        : '<p class="empty">No active sessions.</p>'
    }
  </section>
</body>
</html>`;
}
