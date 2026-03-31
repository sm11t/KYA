import type { ProxyConfig } from "./types.ts";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

interface ConfigFile {
  port?: number;
  host?: string;
  upstream?: string;
  policyDir?: string;
  dbPath?: string;
  jwtSecret?: string;
  x402?: boolean;
}

function loadConfigFile(): ConfigFile {
  const configPath = join(process.cwd(), "kya.config.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

export function loadConfig(): ProxyConfig {
  const file = loadConfigFile();

  // Priority: env vars > kya.config.json > defaults
  return {
    port: process.env.PORT
      ? parseInt(process.env.PORT, 10)
      : file.port ?? 3456,
    host: process.env.HOST ?? file.host ?? "localhost",
    upstreamUrl: process.env.UPSTREAM_MCP_URL ?? file.upstream ?? "http://localhost:4001/mcp",
    policyDir: process.env.POLICY_DIR ?? file.policyDir ?? "./policies",
    dbPath: process.env.DB_PATH ?? file.dbPath ?? "./kya.sqlite",
    jwtSecret: process.env.JWT_SECRET ?? file.jwtSecret ?? "change-me-to-a-random-secret",
  };
}
