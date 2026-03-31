import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { Policy, SessionState } from "./types.ts";

const BUILT_IN_DEFAULT: Policy = {
  agent: "default",
  sessionBudget: 10000,
  perCallMax: 1000,
  allowedTools: [],
  blockedTools: [],
  rateLimit: { maxCallsPerMinute: 120 },
  alertThresholds: [0.5, 0.8, 0.95],
};

export function loadPolicies(dir: string): Policy[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  return files.map((f) => {
    const raw = readFileSync(join(dir, f), "utf-8");
    return JSON.parse(raw) as Policy;
  });
}

export function findPolicy(policies: Policy[], agentId: string): Policy {
  const exact = policies.find((p) => p.agent === agentId);
  if (exact) return exact;

  const fallback = policies.find((p) => p.agent === "default");
  if (fallback) return fallback;

  return BUILT_IN_DEFAULT;
}

export function checkPolicy(
  policy: Policy,
  toolName: string,
  costCents: number,
  session: SessionState,
): { allowed: boolean; reason?: string } {
  if (policy.blockedTools.length > 0 && policy.blockedTools.includes(toolName)) {
    return { allowed: false, reason: `Tool "${toolName}" is blocked by policy` };
  }

  if (policy.allowedTools.length > 0 && !policy.allowedTools.includes(toolName)) {
    return { allowed: false, reason: `Tool "${toolName}" is not in the allowed list` };
  }

  if (costCents > policy.perCallMax) {
    return {
      allowed: false,
      reason: `Cost ${costCents}¢ exceeds per-call max of ${policy.perCallMax}¢`,
    };
  }

  if (session.totalSpentCents + costCents > policy.sessionBudget) {
    return {
      allowed: false,
      reason: `Would exceed session budget: ${session.totalSpentCents + costCents}¢ > ${policy.sessionBudget}¢`,
    };
  }

  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  const recentCalls = session.recentCallTimestamps.filter((t) => t > oneMinuteAgo);
  if (recentCalls.length >= policy.rateLimit.maxCallsPerMinute) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: ${recentCalls.length}/${policy.rateLimit.maxCallsPerMinute} calls per minute`,
    };
  }

  return { allowed: true };
}
