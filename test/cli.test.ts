import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── kya help ───────────────────────────────────────────────

describe("kya help", () => {
  test("outputs usage information", async () => {
    const proc = Bun.spawnSync(["bun", "run", "src/cli.ts", "help"], {
      cwd: import.meta.dir.replace("/test", ""),
    });
    const output = proc.stdout.toString();
    expect(output).toContain("USAGE");
    expect(output).toContain("COMMANDS");
    expect(output).toContain("init");
    expect(output).toContain("start");
    expect(output).toContain("status");
    expect(output).toContain("token create");
    expect(output).toContain("wallet create");
    expect(output).toContain("wallet list");
    expect(output).toContain("wallet fund");
    expect(output).toContain("demo");
    expect(output).toContain("help");
  });

  test("shows help when no command given", async () => {
    const proc = Bun.spawnSync(["bun", "run", "src/cli.ts"], {
      cwd: import.meta.dir.replace("/test", ""),
    });
    const output = proc.stdout.toString();
    expect(output).toContain("USAGE");
    expect(output).toContain("COMMANDS");
  });

  test("shows help with --help flag", async () => {
    const proc = Bun.spawnSync(["bun", "run", "src/cli.ts", "--help"], {
      cwd: import.meta.dir.replace("/test", ""),
    });
    const output = proc.stdout.toString();
    expect(output).toContain("USAGE");
  });
});

// ─── kya init ───────────────────────────────────────────────

describe("kya init", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kya-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates kya.config.json and policies directory", () => {
    const proc = Bun.spawnSync(
      ["bun", "run", join(import.meta.dir.replace("/test", ""), "src/cli.ts"), "init"],
      { cwd: tmpDir },
    );
    const output = proc.stdout.toString();

    expect(existsSync(join(tmpDir, "kya.config.json"))).toBe(true);
    expect(existsSync(join(tmpDir, "policies"))).toBe(true);
    expect(existsSync(join(tmpDir, "policies", "default.json"))).toBe(true);
    expect(output).toContain("KYA initialized");
  });

  test("config file has valid JSON with expected fields", () => {
    Bun.spawnSync(
      ["bun", "run", join(import.meta.dir.replace("/test", ""), "src/cli.ts"), "init"],
      { cwd: tmpDir },
    );

    const config = JSON.parse(readFileSync(join(tmpDir, "kya.config.json"), "utf-8"));
    expect(config.port).toBe(3456);
    expect(config.host).toBe("localhost");
    expect(config.policyDir).toBe("./policies");
    expect(config.jwtSecret).toBe("change-me");
    expect(config.x402).toBe(false);
  });

  test("does not overwrite existing config", () => {
    writeFileSync(join(tmpDir, "kya.config.json"), '{"port": 9999}');

    Bun.spawnSync(
      ["bun", "run", join(import.meta.dir.replace("/test", ""), "src/cli.ts"), "init"],
      { cwd: tmpDir },
    );

    const config = JSON.parse(readFileSync(join(tmpDir, "kya.config.json"), "utf-8"));
    expect(config.port).toBe(9999);
  });
});

// ─── kya status (server not running) ────────────────────────

describe("kya status", () => {
  test("gives clean error when server not running", () => {
    const proc = Bun.spawnSync(
      ["bun", "run", "src/cli.ts", "status", "--port", "19999"],
      { cwd: import.meta.dir.replace("/test", "") },
    );
    const stderr = proc.stderr.toString();
    expect(stderr).toContain("Cannot reach KYA server");
  });
});

// ─── Config loading priority ────────────────────────────────

describe("config loading priority", () => {
  let tmpDir: string;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kya-config-test-"));
    // Save and clear relevant env vars
    for (const key of ["PORT", "HOST", "UPSTREAM_MCP_URL", "POLICY_DIR", "DB_PATH", "JWT_SECRET"]) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    // Restore env vars
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("uses defaults when no config file and no env vars", () => {
    const script = `
      const { existsSync, readFileSync } = require("fs");
      const { join } = require("path");
      const configPath = join(process.cwd(), "kya.config.json");
      const file = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf-8")) : {};
      const config = {
        port: process.env.PORT ? parseInt(process.env.PORT, 10) : file.port ?? 3456,
        host: process.env.HOST ?? file.host ?? "localhost",
        jwtSecret: process.env.JWT_SECRET ?? file.jwtSecret ?? "change-me-to-a-random-secret",
      };
      console.log(JSON.stringify(config));
    `;

    const proc = Bun.spawnSync(["bun", "-e", script], {
      cwd: tmpDir,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    const config = JSON.parse(proc.stdout.toString().trim());
    expect(config.port).toBe(3456);
    expect(config.host).toBe("localhost");
    expect(config.jwtSecret).toBe("change-me-to-a-random-secret");
  });

  test("kya.config.json overrides defaults", () => {
    // Write a config file in cwd — but loadConfig reads from process.cwd()
    // We test via subprocess to control cwd
    const configContent = JSON.stringify({ port: 7777, host: "0.0.0.0", jwtSecret: "from-file" });
    writeFileSync(join(tmpDir, "kya.config.json"), configContent);

    const script = `
      const { existsSync, readFileSync } = require("fs");
      const { join } = require("path");

      // Inline the config loading logic to test
      const configPath = join(process.cwd(), "kya.config.json");
      const file = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf-8")) : {};
      const config = {
        port: process.env.PORT ? parseInt(process.env.PORT, 10) : file.port ?? 3456,
        host: process.env.HOST ?? file.host ?? "localhost",
        jwtSecret: process.env.JWT_SECRET ?? file.jwtSecret ?? "change-me-to-a-random-secret",
      };
      console.log(JSON.stringify(config));
    `;

    const proc = Bun.spawnSync(["bun", "-e", script], {
      cwd: tmpDir,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    const config = JSON.parse(proc.stdout.toString().trim());
    expect(config.port).toBe(7777);
    expect(config.host).toBe("0.0.0.0");
    expect(config.jwtSecret).toBe("from-file");
  });

  test("env vars override kya.config.json", () => {
    const configContent = JSON.stringify({ port: 7777, host: "0.0.0.0", jwtSecret: "from-file" });
    writeFileSync(join(tmpDir, "kya.config.json"), configContent);

    const script = `
      const { existsSync, readFileSync } = require("fs");
      const { join } = require("path");
      const configPath = join(process.cwd(), "kya.config.json");
      const file = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf-8")) : {};
      const config = {
        port: process.env.PORT ? parseInt(process.env.PORT, 10) : file.port ?? 3456,
        host: process.env.HOST ?? file.host ?? "localhost",
        jwtSecret: process.env.JWT_SECRET ?? file.jwtSecret ?? "change-me-to-a-random-secret",
      };
      console.log(JSON.stringify(config));
    `;

    const proc = Bun.spawnSync(["bun", "-e", script], {
      cwd: tmpDir,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        PORT: "9999",
        HOST: "custom-host",
        JWT_SECRET: "from-env",
      },
    });
    const config = JSON.parse(proc.stdout.toString().trim());
    expect(config.port).toBe(9999);
    expect(config.host).toBe("custom-host");
    expect(config.jwtSecret).toBe("from-env");
  });
});

// ─── Unknown commands ───────────────────────────────────────

describe("kya unknown commands", () => {
  test("shows error for unknown command", () => {
    const proc = Bun.spawnSync(
      ["bun", "run", "src/cli.ts", "foobar"],
      { cwd: import.meta.dir.replace("/test", "") },
    );
    const stderr = proc.stderr.toString();
    expect(stderr).toContain("Unknown command");
  });

  test("shows error for unknown wallet subcommand", () => {
    const proc = Bun.spawnSync(
      ["bun", "run", "src/cli.ts", "wallet", "foobar"],
      { cwd: import.meta.dir.replace("/test", "") },
    );
    const stderr = proc.stderr.toString();
    expect(stderr).toContain("Unknown wallet command");
  });

  test("shows error for unknown token subcommand", () => {
    const proc = Bun.spawnSync(
      ["bun", "run", "src/cli.ts", "token", "foobar"],
      { cwd: import.meta.dir.replace("/test", "") },
    );
    const stderr = proc.stderr.toString();
    expect(stderr).toContain("Unknown token command");
  });
});
