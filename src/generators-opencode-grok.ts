import { existsSync, unlinkSync } from "fs";
import { join, relative } from "path";
import { REPO_DIR, parseFrontmatter, readText, sha256, titleize, unifiedDiff, walkFiles, writeText, yamlBlock } from "./lib.ts";
import { DEFAULT_MODEL, loadDelegation, type DelegationData } from "./delegation.ts";
import { AGENTS_DIR, buildMultiDiff, composeHostDoctrine, log, rewritePaths, writeLedger } from "./generators-shared.ts";

// --- opencode native subagents reflect ---

const OPENCODE_AGENTS_DIR = process.env.OPENCODE_REPO_AGENTS_DIR ?? join(REPO_DIR, "opencode", "agents");
const OPENCODE_AGENT_PATCH = process.env.OPENCODE_AGENT_REFLECT_PATCH ?? join(REPO_DIR, ".opencode-agent-reflect.patch");
const OPENCODE_AGENT_RATIONALE = process.env.OPENCODE_AGENT_REFLECT_RATIONALE ?? join(REPO_DIR, ".opencode-agent-reflect.rationale");
const OPENCODE_AGENT_STATUSES = process.env.OPENCODE_AGENT_REFLECT_STATUSES ?? join(REPO_DIR, ".opencode-agent-reflect.statuses.json");
const OPENCODE_AGENT_LEDGER = process.env.OPENCODE_AGENT_REFLECT_LEDGER ?? join(REPO_DIR, "opencode-agent-reflect-ledger.jsonl");
const OPENCODE_AGENT_MARKER = "<!-- GENERATED-OPENCODE-AGENT: source=";

const OPENCODE_AGENT_SRC_DIR = join(REPO_DIR, "opencode", "agents-src");

/**
 * Native OpenCode subagents.
 *
 * Shared `agents/*.md` sources cover the generic reviewers. `agents/adv-review.md`
 * is deliberately not used: it is a lead invocation procedure, not a reviewer
 * prompt, so the OpenCode reviewer prompt lives in `opencode/agents-src/`.
 *
 * `opencode/agents/` is generated. A spec that maps to a delegation role gets
 * its `model` injected from `delegation.toml`, so a binding change never needs a
 * manual edit to an output agent file. Agents without a role inherit the session
 * model, so they carry no `model`.
 */
type OpencodeAgentSpec = {
  name: string;
  /** Delegation role whose model is injected. Absent means inherit the session model. */
  role?: string;
  source: string;
  readOnly: boolean;
  /** Shared sources get the generated runtime-notes preamble. */
  shared: boolean;
};

const OPENCODE_AGENT_SPECS: OpencodeAgentSpec[] = [
  { name: "adv-review", role: "adv_review", source: join(OPENCODE_AGENT_SRC_DIR, "adv-review.md"), readOnly: true, shared: false },
  { name: "ai-engineer", source: join(AGENTS_DIR, "ai-engineer.md"), readOnly: true, shared: true },
  { name: "implementer", role: "implementer", source: join(OPENCODE_AGENT_SRC_DIR, "implementer.md"), readOnly: false, shared: false },
  { name: "principal-engineer", source: join(AGENTS_DIR, "principal-engineer.md"), readOnly: true, shared: true },
  { name: "scout", role: "scout", source: join(AGENTS_DIR, "scout.md"), readOnly: true, shared: true },
  { name: "simplifier", role: "simplifier", source: join(AGENTS_DIR, "simplifier.md"), readOnly: true, shared: true },
];

const OPENCODE_READ_ONLY_PERMISSIONS = `permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: subagent
    resource: "*"
    effect: deny`;

function opencodeDelegationData(): DelegationData {
  return loadDelegation(join(REPO_DIR, "delegation.toml"));
}

export function generatedOpencodeAgent(
  spec: OpencodeAgentSpec,
  data: DelegationData = opencodeDelegationData(),
): [string, string, Record<string, string>] {
  const raw = readText(spec.source);
  const { meta, body } = parseFrontmatter(raw);
  const description = meta.description ?? `OpenCode-native ${spec.name} subagent generated from shared doctrine.`;
  const relSource = relative(REPO_DIR, spec.source).replace(/\\/g, "/");
  const target = join(OPENCODE_AGENTS_DIR, `${spec.name}.md`);
  const model = spec.role ? data.opencode[spec.role]?.model : undefined;
  const sourceBody = rewritePaths(body, "opencode").replace(/^\n+/, "");

  const front = ["---", yamlBlock("description", description), "mode: subagent"];
  if (model && model !== DEFAULT_MODEL) front.push(`model: ${model}`);
  if (spec.readOnly) front.push(OPENCODE_READ_ONLY_PERMISSIONS);
  front.push("---");

  const preamble = spec.shared
    ? `# ${titleize(spec.name)}

This OpenCode subagent is generated from \`${relSource}\`. Do not edit it by hand; update the shared agent source and run \`./sync.sh generate-opencode-agents\`.

## OpenCode Runtime Notes

- Treat this as the OpenCode-native form of the shared \`${spec.name}\` agent.
- Read \`~/.config/opencode/TENETS.md\` when the source agent asks for the shared engineering contract.
- Preserve the read-only constraint: propose, review, and verify, but do not mutate files. The \`edit\` and \`subagent\` actions are denied.

## Agent Instructions

`
    : "";

  const agent = `${front.join("\n")}

${OPENCODE_AGENT_MARKER}${relSource} -->

${preamble}${sourceBody}`;
  return [
    target,
    agent,
    {
      kind: "agent",
      source: relSource,
      target: relative(REPO_DIR, target).replace(/\\/g, "/"),
      name: spec.name,
      source_sha256: sha256(raw),
      target_sha256: sha256(agent),
    },
  ];
}

/** Render one role agent. Exposed so tests can prove the model comes from delegation data. */
export function opencodeRoleAgent(
  role: string,
  data?: DelegationData,
): [string, string, Record<string, string>] {
  const spec = OPENCODE_AGENT_SPECS.find((candidate) => candidate.role === role);
  if (!spec) throw new Error(`unknown opencode role agent: ${role}`);
  return generatedOpencodeAgent(spec, data);
}

function desiredOpencodeAgents(): [string, string, Record<string, string>][] {
  return OPENCODE_AGENT_SPECS.filter((spec) => existsSync(spec.source)).map((spec) =>
    generatedOpencodeAgent(spec),
  );
}

function generatedOpencodeExisting(): string[] {
  if (!existsSync(OPENCODE_AGENTS_DIR)) return [];
  const out: string[] = [];
  for (const path of walkFiles(OPENCODE_AGENTS_DIR)) {
    if (path.endsWith(".md") && readText(path).includes(OPENCODE_AGENT_MARKER)) out.push(path);
  }
  return out;
}

export function opencodeAgentReflectPreview(): void {
  const items = desiredOpencodeAgents();
  const [patch, statuses] = buildMultiDiff(items, generatedOpencodeExisting);
  writeText(OPENCODE_AGENT_PATCH, patch);
  writeText(OPENCODE_AGENT_STATUSES, `${JSON.stringify(statuses, null, 2)}\n`);
  const changed = statuses.filter((s) => s.status !== "unchanged");
  const rationale = `Generated ${items.length} OpenCode native subagent(s) from shared agents/*.md and opencode/agents-src/*.md. ${changed.length} target(s) need changes. Role agents take their model from delegation.toml; subagents receive mode: subagent, OpenCode permission rules, and path references rewritten to ~/.config/opencode.`;
  writeText(OPENCODE_AGENT_RATIONALE, `${rationale}\n`);
  log("opencode-agent-reflect", rationale);
  if (patch) process.stdout.write(patch);
}

export function opencodeAgentReflectApply(): void {
  const items = desiredOpencodeAgents();
  const [, statuses] = buildMultiDiff(items, generatedOpencodeExisting);
  const now = new Date().toISOString();
  let changed = 0;
  const desiredTargets = new Set(items.map(([t]) => t));
  for (const [target, desired, meta] of items) {
    if (readText(target) !== desired) {
      writeText(target, desired);
      changed++;
      writeLedger(OPENCODE_AGENT_LEDGER, { timestamp: now, action: "write", ...meta });
      log("opencode-agent-reflect", `wrote ${relative(REPO_DIR, target)}`);
    }
  }
  for (const obsolete of generatedOpencodeExisting()) {
    if (desiredTargets.has(obsolete)) continue;
    const rel = relative(REPO_DIR, obsolete).replace(/\\/g, "/");
    unlinkSync(obsolete);
    changed++;
    writeLedger(OPENCODE_AGENT_LEDGER, { timestamp: now, action: "delete", target: rel });
    log("opencode-agent-reflect", `deleted obsolete ${rel}`);
  }
  if (!changed) log("opencode-agent-reflect", "generated OpenCode subagents are already current");
  writeText(OPENCODE_AGENT_STATUSES, `${JSON.stringify(statuses, null, 2)}\n`);
}

// --- opencode AGENTS.md reflect ---

const OPENCODE_AGENTS_MD_PATCH = process.env.OPENCODE_AGENTS_MD_REFLECT_PATCH ?? join(REPO_DIR, ".opencode-agents-md-reflect.patch");
const OPENCODE_AGENTS_MD_RATIONALE = process.env.OPENCODE_AGENTS_MD_REFLECT_RATIONALE ?? join(REPO_DIR, ".opencode-agents-md-reflect.rationale");
const OPENCODE_AGENTS_MD_STATUSES = process.env.OPENCODE_AGENTS_MD_REFLECT_STATUSES ?? join(REPO_DIR, ".opencode-agents-md-reflect.statuses.json");
const OPENCODE_AGENTS_MD_LEDGER = process.env.OPENCODE_AGENTS_MD_REFLECT_LEDGER ?? join(REPO_DIR, "opencode-agents-md-reflect-ledger.jsonl");
const OPENCODE_AGENTS_MD_MARKER = "<!-- GENERATED-OPENCODE-AGENTS: source=CLAUDE.md+hosts/opencode.md+delegation.toml -->";

export function generatedOpencodeAgentsMd(): [string, string, Record<string, string>] {
  const target = join(REPO_DIR, "opencode", "AGENTS.md");
  const rendered = rewritePaths(composeHostDoctrine("opencode"), "opencode", false);
  const output = `${OPENCODE_AGENTS_MD_MARKER}\n\n${rendered}`;
  return [
    target,
    output,
    {
      source: "CLAUDE.md+hosts/opencode.md+delegation.toml",
      target: "opencode/AGENTS.md",
      source_sha256: sha256(rendered),
      target_sha256: sha256(output),
    },
  ];
}

export function opencodeAgentsMdReflectPreview(): void {
  const [target, desired, meta] = generatedOpencodeAgentsMd();
  const current = readText(target);
  const status = current === desired ? "unchanged" : existsSync(target) ? "update" : "create";
  const patch =
    current !== desired
      ? unifiedDiff(current.replace(/\n$/, ""), desired.replace(/\n$/, ""), `a/${meta.target}`, `b/${meta.target}`)
      : "";
  writeText(OPENCODE_AGENTS_MD_PATCH, patch || "NO_CHANGES\n");
  writeText(OPENCODE_AGENTS_MD_STATUSES, `${JSON.stringify([{ ...meta, status }], null, 2)}\n`);
  const rationale = `Generated opencode/AGENTS.md from CLAUDE.md, hosts/opencode.md, and delegation.toml (${status}).`;
  writeText(OPENCODE_AGENTS_MD_RATIONALE, `${rationale}\n`);
  log("opencode-agents-md-reflect", rationale);
  if (patch) process.stdout.write(patch);
}

export function opencodeAgentsMdReflectApply(): void {
  const [target, desired, meta] = generatedOpencodeAgentsMd();
  const current = readText(target);
  if (current === desired) {
    log("opencode-agents-md-reflect", "opencode/AGENTS.md is already current");
    writeText(OPENCODE_AGENTS_MD_STATUSES, `${JSON.stringify([{ ...meta, status: "unchanged" }], null, 2)}\n`);
    return;
  }
  writeText(target, desired);
  writeLedger(OPENCODE_AGENTS_MD_LEDGER, { timestamp: new Date().toISOString(), action: "write", ...meta });
  log("opencode-agents-md-reflect", `wrote ${meta.target}`);
  writeText(OPENCODE_AGENTS_MD_STATUSES, `${JSON.stringify([{ ...meta, status: "update" }], null, 2)}\n`);
}

// --- grok rule and agents ---

const GROK_RULES_DIR = join(REPO_DIR, "grok", "rules");
const GROK_AGENTS_DIR = join(REPO_DIR, "grok", "agents");
const GROK_DOCTRINE_MARKER = "<!-- GENERATED-GROK-DOCTRINE: source=CLAUDE.md+hosts/grok.md+delegation.toml -->";
const GROK_OBSOLETE_AGENTS = ["implementer-light.md"];

type GrokAgentSpec = {
  file: string;
  name: string;
  role: "simplifier" | "adv_review" | "implementer" | "scout";
  permission: "plan" | "default";
  description: string;
};

const GROK_AGENT_SPECS: GrokAgentSpec[] = [
  {
    file: "simplifier.md",
    name: "simplifier",
    role: "simplifier",
    permission: "plan",
    description: "Simplify the porch note the parent names. Do not spawn a subagent.",
  },
  {
    file: "adv-review.md",
    name: "adv-review",
    role: "adv_review",
    permission: "plan",
    description: "Review the porch note the parent names. Do not spawn a subagent.",
  },
  {
    file: "implementer.md",
    name: "implementer",
    role: "implementer",
    permission: "default",
    description: "Implement the porch note the parent names. Do not spawn a subagent.",
  },
  {
    file: "scout.md",
    name: "scout",
    role: "scout",
    permission: "plan",
    description: "Gather facts for the porch note the parent names. Do not spawn a subagent.",
  },
];

function grokDelegationData(): DelegationData {
  return loadDelegation(join(REPO_DIR, "delegation.toml"));
}

export function generatedGrokRule(): [string, string, Record<string, string>] {
  const raw = composeHostDoctrine("grok");
  const target = join(GROK_RULES_DIR, "doctrine.md");
  const rule = `${GROK_DOCTRINE_MARKER}

# Shared doctrine

This Grok rule is generated from shared doctrine, \`hosts/grok.md\`, and \`delegation.toml\`. Do not edit it by hand; update its sources and run \`./sync.sh pull-grok\`.

Before any substantial work, read \`~/.grok/TASTE.md\`, \`~/.grok/TENETS.md\`, and \`~/.grok/LOCAL.md\` (see Session start below). Trivial one-liners may skip.

${raw}`;
  return [
    target,
    rule,
    {
      source: "CLAUDE.md+hosts/grok.md+delegation.toml",
      target: "grok/rules/doctrine.md",
      source_sha256: sha256(raw),
      target_sha256: sha256(rule),
    },
  ];
}

export function generatedGrokAgent(
  spec: GrokAgentSpec,
  data: DelegationData = grokDelegationData(),
): [string, string] {
  const model = data.grok?.[spec.role]?.model;
  if (!model) throw new Error(`delegation.toml: missing model for [grok.${spec.role}]`);
  const target = join(GROK_AGENTS_DIR, spec.file);
  const agent = `---
name: ${spec.name}
description: ${spec.description}
prompt_mode: full
permission_mode: ${spec.permission}
${model === DEFAULT_MODEL ? "" : `model: ${model}\n`}agents_md: true
---

read the porch note the parent names, trust it, do not spawn a subagent.
`;
  return [target, agent];
}

export function grokRoleAgent(role: GrokAgentSpec["role"], data?: DelegationData): [string, string] {
  const spec = GROK_AGENT_SPECS.find((candidate) => candidate.role === role);
  if (!spec) throw new Error(`unknown grok role agent: ${role}`);
  return generatedGrokAgent(spec, data);
}

export function renderGrokDoctrine(): void {
  const [target, desired] = generatedGrokRule();
  if (readText(target) !== desired) writeText(target, desired);
  for (const spec of GROK_AGENT_SPECS) {
    const [path, text] = generatedGrokAgent(spec);
    if (readText(path) !== text) writeText(path, text);
  }
  for (const name of GROK_OBSOLETE_AGENTS) {
    const path = join(GROK_AGENTS_DIR, name);
    if (existsSync(path)) unlinkSync(path);
  }
}

// --- muse agents md ---

const MUSE_DOCTRINE_MARKER = "<!-- GENERATED-MUSE-AGENTS: source=CLAUDE.md+hosts/muse.md+delegation.toml -->";

export function generatedMuseAgentsMd(): [string, string, Record<string, string>] {
  const raw = composeHostDoctrine("muse");
  const target = join(REPO_DIR, "muse", "AGENTS.md");
  const rule = `${MUSE_DOCTRINE_MARKER}

# Shared doctrine

This Muse file is generated from shared doctrine, \`hosts/muse.md\`, and \`delegation.toml\`. Do not edit it by hand; update its sources and run \`./sync.sh pull-muse\`.

Before any substantial work, read \`~/.config/muse/TASTE.md\`, \`~/.config/muse/TENETS.md\`, and \`~/.config/muse/LOCAL.md\` (see Session start below). Trivial one-liners may skip.

${raw}`;
  return [
    target,
    rule,
    {
      source: "CLAUDE.md+hosts/muse.md+delegation.toml",
      target: "muse/AGENTS.md",
      source_sha256: sha256(raw),
      target_sha256: sha256(rule),
    },
  ];
}

export function renderMuseDoctrine(): void {
  const [target, desired] = generatedMuseAgentsMd();
  if (readText(target) !== desired) writeText(target, desired);
}
