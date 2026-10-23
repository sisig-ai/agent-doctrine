/**
 * handoff guard: reject a subagent delegation that does not carry exactly one
 * valid handoff pointer with a current receipt.
 *
 * the guard covers ordinary agent workflows. a same-user shell can edit a note
 * or drop a receipt, so this is not a security boundary.
 *
 * the compressor child sets HANDOFF_GUARD_DISABLE=1 and has no tools, so a
 * handoff cannot recurse. both are defense in depth, not a boundary.
 */

import { spawnSync } from "child_process";
import { homedir } from "os";
import { join } from "path";

const DELEGATION_TOOLS = new Set(["subagent", "task"]);

export function defaultCorePath(): string {
  return process.env.HANDOFF_CORE ?? join(homedir(), ".config", "opencode", "handoff.ts");
}

export interface DelegationGuard {
  verify: (prompt: string) => { ok: boolean; reason?: string };
}

/** run the core's strict one-pointer check in a child so the format has one source. */
export function spawnEnforce(corePath: string): DelegationGuard["verify"] {
  return (prompt) => {
    const run = spawnSync("bun", [corePath, "verify-delegation", "--harness", "opencode"], { input: prompt, encoding: "utf-8" });
    if (run.error) return { ok: false, reason: `verify-delegation failed to run: ${run.error.message}` };
    if (run.status === 0) return { ok: true };
    return { ok: false, reason: (run.stderr ?? "").trim() || `verify-delegation exited ${run.status}` };
  };
}

/** reject a delegation whose prompt is missing, or is not exactly one valid pointer. */
export function checkDelegation(input: unknown, guard: DelegationGuard): void {
  const prompt = typeof (input as { prompt?: unknown } | null)?.prompt === "string" ? (input as { prompt: string }).prompt : "";
  if (!prompt) throw new Error("delegation rejected: tool input carries no prompt");
  const verdict = guard.verify(prompt);
  if (!verdict.ok) throw new Error(`delegation rejected: ${verdict.reason ?? "missing handoff receipt"}`);
}

export interface GuardOptions {
  corePath?: string;
  verify?: DelegationGuard["verify"];
}

export function registerHandoffGuard(ctx: any, options: GuardOptions = {}): unknown {
  if (process.env.HANDOFF_GUARD_DISABLE === "1") return () => {};
  const guard: DelegationGuard = { verify: options.verify ?? spawnEnforce(options.corePath ?? defaultCorePath()) };
  return ctx.tool.hook("execute.before", (event: any) => {
    if (!DELEGATION_TOOLS.has(event?.tool)) return;
    checkDelegation(event.input, guard);
  });
}

export default { id: "handoff", setup: (ctx: any) => registerHandoffGuard(ctx) };
