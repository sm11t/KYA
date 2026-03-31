import type { ProxyConfig } from "./types.ts";

export function loadConfig(): ProxyConfig {
  return {
    port: parseInt(process.env.PORT || "3456", 10),
    host: process.env.HOST || "localhost",
    upstreamUrl: process.env.UPSTREAM_MCP_URL || "http://localhost:4001/mcp",
    policyDir: process.env.POLICY_DIR || "./policies",
    dbPath: process.env.DB_PATH || "./kya.sqlite",
    jwtSecret: process.env.JWT_SECRET || "change-me-to-a-random-secret",
  };
}
