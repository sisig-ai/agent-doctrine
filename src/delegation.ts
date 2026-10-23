import { readFileSync } from "fs";
import { parse } from "smol-toml";

export const ROLES = ["simplifier", "adv_review", "implementer", "scout"] as const;
export const OPTIONAL_ROLES = ["implementer_light"] as const;
/** Model value meaning "pass no model; the host uses its default". */
export const DEFAULT_MODEL = "default";
const KNOWN_ROLES: readonly string[] = [...ROLES, ...OPTIONAL_ROLES];

function rolesFor(table: object): string[] {
  return [...ROLES, ...OPTIONAL_ROLES.filter((r) => r in table)];
}

export const TARGETS = ["claude", "codex", "cursor", "opencode", "grok", "muse"] as const;
export const TARGET_RUNTIMES: Record<(typeof TARGETS)[number], ReadonlySet<string>> = {
  claude: new Set(["claude-agent"]),
  codex: new Set(["codex-subagent"]),
  cursor: new Set(["cursor-subagent"]),
  opencode: new Set(["opencode-subagent"]),
  grok: new Set(["grok-subagent"]),
  muse: new Set(["muse-subagent"]),
};

export const INVOKE: Record<string, string> = {
  "claude-agent": "spawn the Claude agent named for the role (adv_review -> adv-review, implementer_light -> implementer-light)",
  "codex-subagent": "spawn native Codex subagent with this model",
  "cursor-subagent": "spawn Cursor Task/subagent with this model",
  "opencode-subagent": "spawn native OpenCode subagent with this model",
  "grok-subagent": "spawn a Grok subagent with this model via spawn_subagent",
  "muse-subagent": "spawn a Muse subagent with this model",
};

export const BEGIN = "<!-- DELEGATION:BEGIN -->";
export const END = "<!-- DELEGATION:END -->";

export type DelegationData = Record<string, Record<string, { model: string; runtime: string }>>;

export function loadDelegation(path: string): DelegationData {
  const raw = parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  const unknownTargets = Object.keys(raw).filter((k) => !TARGETS.includes(k as (typeof TARGETS)[number]));
  if (unknownTargets.length) {
    throw new Error(`delegation.toml: unknown target(s): ${unknownTargets.sort().join(", ")}`);
  }
  const data = raw as DelegationData;
  for (const target of TARGETS) {
    if (!(target in data)) throw new Error(`delegation.toml: missing target [${target}]`);
    const table = data[target];
    if (!table || typeof table !== "object") throw new Error(`delegation.toml: [${target}] must be a table`);
    const unknownRoles = Object.keys(table).filter((r) => !KNOWN_ROLES.includes(r));
    if (unknownRoles.length) {
      throw new Error(`delegation.toml: unknown role(s) under [${target}]: ${unknownRoles.sort().join(", ")}`);
    }
    for (const role of ROLES) {
      if (!(role in table)) throw new Error(`delegation.toml: missing role [${target}.${role}]`);
    }
    for (const role of rolesFor(table)) {
      const entry = table[role];
      if (!entry || typeof entry !== "object") throw new Error(`delegation.toml: [${target}.${role}] must be a table`);
      const unknownKeys = Object.keys(entry).filter((k) => k !== "model" && k !== "runtime");
      if (unknownKeys.length) {
        throw new Error(`delegation.toml: unknown key(s) in [${target}.${role}]: ${unknownKeys.sort().join(", ")}`);
      }
      const model = entry.model;
      const runtime = entry.runtime;
      if (typeof model !== "string" || !model.trim()) {
        throw new Error(`delegation.toml: model for [${target}.${role}] must be a nonempty string`);
      }
      if (typeof runtime !== "string") {
        throw new Error(`delegation.toml: runtime for [${target}.${role}] must be a string`);
      }
      if (!TARGET_RUNTIMES[target].has(runtime)) {
        throw new Error(
          `delegation.toml: runtime ${JSON.stringify(runtime)} is invalid for [${target}.${role}]; allowed: ${[...TARGET_RUNTIMES[target]].join(", ")}`,
        );
      }
      entry.model = model.trim();
    }
  }
  return data;
}

export function delegationTable(target: string, data: DelegationData): string {
  const rows = ["| Role | Model | Runtime | Invoke |", "| --- | --- | --- | --- |"];
  for (const role of rolesFor(data[target])) {
    const entry = data[target][role];
    rows.push(`| ${role} | ${entry.model} | ${entry.runtime} | ${INVOKE[entry.runtime]} |`);
  }
  return `${rows.join("\n")}\n`;
}

export function renderDelegation(body: string, target: string, data: DelegationData): string {
  const beginCount = (body.match(new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
  const endCount = (body.match(new RegExp(END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
  if (beginCount === 0 || endCount === 0) {
    throw new Error(`render_delegation: missing DELEGATION markers in body (BEGIN=${beginCount}, END=${endCount})`);
  }
  if (beginCount > 1 || endCount > 1) {
    throw new Error(`render_delegation: duplicate DELEGATION markers in body (BEGIN=${beginCount}, END=${endCount})`);
  }
  const beginAt = body.indexOf(BEGIN);
  const endAt = body.indexOf(END);
  if (beginAt > endAt) throw new Error("render_delegation: DELEGATION markers out of order (END before BEGIN)");
  const table = delegationTable(target, data);
  const replacement = `${BEGIN}\n\n${table}\n${END}`;
  return body.slice(0, beginAt) + replacement + body.slice(endAt + END.length);
}
