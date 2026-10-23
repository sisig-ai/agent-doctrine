import { existsSync, readdirSync, unlinkSync } from "fs";
import { join, relative } from "path";
import { REPO_DIR, parseFrontmatter, readText, sha256, titleize, unifiedDiff, walkFiles, writeText, yamlBlock } from "./lib.ts";
import { AGENTS_DIR, buildMultiDiff, composeHostDoctrine, log, rewritePaths, writeLedger } from "./generators-shared.ts";

// --- agent reflect (codex skills) ---

const CODEX_SKILLS_DIR = process.env.CODEX_AGENT_SKILLS_DIR ?? join(REPO_DIR, "codex", "skills");
const AGENT_PATCH = process.env.AGENT_REFLECT_PATCH ?? join(REPO_DIR, ".agent-reflect.patch");
const AGENT_RATIONALE = process.env.AGENT_REFLECT_RATIONALE ?? join(REPO_DIR, ".agent-reflect.rationale");
const AGENT_STATUSES = process.env.AGENT_REFLECT_STATUSES ?? join(REPO_DIR, ".agent-reflect.statuses.json");
const AGENT_LEDGER = process.env.AGENT_REFLECT_LEDGER ?? join(REPO_DIR, "agent-reflect-ledger.jsonl");
const CODEX_AGENT_MARKER = "<!-- GENERATED-CODEX-AGENT: source=agents/";

function transformCodexBody(body: string): string {
  return rewritePaths(body, "codex");
}

function generatedCodexSkill(source: string): [string, string, Record<string, string>] {
  const raw = readText(source);
  const { meta, body } = parseFrontmatter(raw);
  const name = meta.name ?? source.split("/").pop()!.replace(/\.md$/, "");
  const description = meta.description ?? `Codex-native ${name} agent generated from shared doctrine.`;
  const relSource = relative(REPO_DIR, source).replace(/\\/g, "/");
  const target = join(CODEX_SKILLS_DIR, name, "SKILL.md");
  const sourceBody = transformCodexBody(body);
  const skill = `---
name: ${name}
${yamlBlock("description", description)}
---

${CODEX_AGENT_MARKER}${relSource} -->

# ${titleize(name)}

This Codex skill is generated from \`${relSource}\`. Do not edit it by hand; update the shared agent source and run \`./sync.sh generate-codex-agents\`.

## Codex Runtime Notes

- Treat this as the Codex-native form of the shared \`${name}\` agent.
- Use the tools available in the active Codex context; Claude-specific \`tools\` and \`model\` frontmatter from the source file is provenance, not a Codex runtime contract.
- Read \`~/.codex/TENETS.md\` when the source agent asks for the shared engineering contract.
- Preserve any read-only constraint from the source agent: propose, review, and verify, but do not mutate files when the agent says it is read-only.

## Agent Instructions

${sourceBody}`;
  return [
    target,
    skill,
    {
      source: relSource,
      target: relative(REPO_DIR, target).replace(/\\/g, "/"),
      name,
      source_sha256: sha256(raw),
      target_sha256: sha256(skill),
    },
  ];
}

function desiredCodexSkills(): [string, string, Record<string, string>][] {
  if (!existsSync(AGENTS_DIR)) return [];
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => generatedCodexSkill(join(AGENTS_DIR, f)));
}

function generatedCodexExisting(): string[] {
  if (!existsSync(CODEX_SKILLS_DIR)) return [];
  const out: string[] = [];
  for (const path of walkFiles(CODEX_SKILLS_DIR)) {
    if (path.endsWith("SKILL.md") && readText(path).includes(CODEX_AGENT_MARKER)) out.push(path);
  }
  return out;
}

export function agentReflectPreview(): void {
  const items = desiredCodexSkills();
  const [patch, statuses] = buildMultiDiff(items, generatedCodexExisting);
  writeText(AGENT_PATCH, patch);
  writeText(AGENT_STATUSES, `${JSON.stringify(statuses, null, 2)}\n`);
  const changed = statuses.filter((s) => s.status !== "unchanged");
  const rationale = `Generated ${items.length} Codex agent skill(s) from shared agents/*.md. ${changed.length} target(s) need changes. Claude frontmatter tools/model fields are treated as provenance; Codex skills receive runtime notes and path references rewritten to ~/.codex.`;
  writeText(AGENT_RATIONALE, `${rationale}\n`);
  log("agent-reflect", rationale);
  if (patch) process.stdout.write(patch);
}

export function agentReflectApply(): void {
  const items = desiredCodexSkills();
  const [, statuses] = buildMultiDiff(items, generatedCodexExisting);
  const now = new Date().toISOString();
  let changed = 0;
  const desiredTargets = new Set(items.map(([t]) => t));
  for (const [target, desired, meta] of items) {
    if (readText(target) !== desired) {
      writeText(target, desired);
      changed++;
      writeLedger(AGENT_LEDGER, { timestamp: now, action: "write", ...meta });
      log("agent-reflect", `wrote ${relative(REPO_DIR, target)}`);
    }
  }
  for (const obsolete of generatedCodexExisting()) {
    if (desiredTargets.has(obsolete)) continue;
    const rel = relative(REPO_DIR, obsolete).replace(/\\/g, "/");
    unlinkSync(obsolete);
    changed++;
    writeLedger(AGENT_LEDGER, { timestamp: now, action: "delete", target: rel });
    log("agent-reflect", `deleted obsolete ${rel}`);
  }
  if (!changed) log("agent-reflect", "generated Codex agent skills are already current");
  writeText(AGENT_STATUSES, `${JSON.stringify(statuses, null, 2)}\n`);
}

// --- cursor rule reflect ---

const CURSOR_RULES_DIR = process.env.CURSOR_REPO_RULES_DIR ?? join(REPO_DIR, "cursor", "rules");
const CURSOR_RULE_PATCH = process.env.CURSOR_RULE_REFLECT_PATCH ?? join(REPO_DIR, ".cursor-rule-reflect.patch");
const CURSOR_RULE_RATIONALE = process.env.CURSOR_RULE_REFLECT_RATIONALE ?? join(REPO_DIR, ".cursor-rule-reflect.rationale");
const CURSOR_RULE_STATUSES = process.env.CURSOR_RULE_REFLECT_STATUSES ?? join(REPO_DIR, ".cursor-rule-reflect.statuses.json");
const CURSOR_RULE_LEDGER = process.env.CURSOR_RULE_REFLECT_LEDGER ?? join(REPO_DIR, "cursor-rule-reflect-ledger.jsonl");
const CURSOR_DOCTRINE_MARKER = "<!-- GENERATED-CURSOR-DOCTRINE: source=CLAUDE.md+hosts/cursor.md+delegation.toml -->";

function transformCursorBody(body: string): string {
  return rewritePaths(body, "cursor");
}

export function generatedCursorRule(): [string, string, Record<string, string>] {
  const source = join(REPO_DIR, "CLAUDE.md");
  const raw = composeHostDoctrine("cursor");
  const body = transformCursorBody(raw);
  const target = join(CURSOR_RULES_DIR, "doctrine.mdc");
  const rule = `---
description: Shared doctrine operating contract synced from the claude-md repo
alwaysApply: true
---

${CURSOR_DOCTRINE_MARKER}

# Shared doctrine

This Cursor rule is generated from shared doctrine, \`hosts/cursor.md\`, and \`delegation.toml\`. Do not edit it by hand; update its sources and run \`./sync.sh generate-cursor-rules\`.

Before any substantial work, read \`~/.cursor/TASTE.md\`, \`~/.cursor/TENETS.md\`, and \`~/.cursor/LOCAL.md\` (see Session start below). Trivial one-liners may skip.

${body}`;
  return [
    target,
    rule,
    {
      source: "CLAUDE.md+hosts/cursor.md+delegation.toml",
      target: "cursor/rules/doctrine.mdc",
      source_sha256: sha256(raw),
      target_sha256: sha256(rule),
    },
  ];
}

export function cursorRuleReflectPreview(): void {
  const [target, desired, meta] = generatedCursorRule();
  const current = readText(target);
  const status = current === desired ? "unchanged" : existsSync(target) ? "update" : "create";
  const patch =
    current !== desired
      ? unifiedDiff(current.replace(/\n$/, ""), desired.replace(/\n$/, ""), `a/${meta.target}`, `b/${meta.target}`)
      : "";
  writeText(CURSOR_RULE_PATCH, patch || "NO_CHANGES\n");
  writeText(CURSOR_RULE_STATUSES, `${JSON.stringify([{ ...meta, status }], null, 2)}\n`);
  const rationale = `Generated Cursor doctrine rule from CLAUDE.md, hosts/cursor.md, and delegation.toml (${status}).`;
  writeText(CURSOR_RULE_RATIONALE, `${rationale}\n`);
  log("cursor-rule-reflect", rationale);
  if (patch) process.stdout.write(patch);
}

export function cursorRuleReflectApply(): void {
  const [target, desired, meta] = generatedCursorRule();
  const current = readText(target);
  if (current === desired) {
    log("cursor-rule-reflect", "cursor doctrine rule is already current");
    writeText(CURSOR_RULE_STATUSES, `${JSON.stringify([{ ...meta, status: "unchanged" }], null, 2)}\n`);
    return;
  }
  writeText(target, desired);
  writeLedger(CURSOR_RULE_LEDGER, { timestamp: new Date().toISOString(), action: "write", ...meta });
  log("cursor-rule-reflect", `wrote ${meta.target}`);
  writeText(CURSOR_RULE_STATUSES, `${JSON.stringify([{ ...meta, status: "update" }], null, 2)}\n`);
}

// --- cursor agent reflect ---

const CURSOR_AGENTS_DIR = process.env.CURSOR_REPO_AGENTS_DIR ?? join(REPO_DIR, "cursor", "agents");
const CURSOR_SKILLS_DIR = process.env.CURSOR_AGENT_SKILLS_DIR ?? join(REPO_DIR, "cursor", "skills");
const CURSOR_AGENT_PATCH = process.env.CURSOR_AGENT_REFLECT_PATCH ?? join(REPO_DIR, ".cursor-agent-reflect.patch");
const CURSOR_AGENT_RATIONALE = process.env.CURSOR_AGENT_REFLECT_RATIONALE ?? join(REPO_DIR, ".cursor-agent-reflect.rationale");
const CURSOR_AGENT_STATUSES = process.env.CURSOR_AGENT_REFLECT_STATUSES ?? join(REPO_DIR, ".cursor-agent-reflect.statuses.json");
const CURSOR_AGENT_LEDGER = process.env.CURSOR_AGENT_REFLECT_LEDGER ?? join(REPO_DIR, "cursor-agent-reflect-ledger.jsonl");
const CURSOR_AGENT_MARKER = "<!-- GENERATED-CURSOR-AGENT: source=agents/";
const CURSOR_SKILL_MARKER = "<!-- GENERATED-CURSOR-AGENT-SKILL: source=agents/";

function transformCursorAgentBody(body: string): string {
  return rewritePaths(body, "cursorAgent");
}

function generatedCursorAgent(source: string): [string, string, Record<string, string>] {
  const raw = readText(source);
  const { meta, body } = parseFrontmatter(raw);
  const name = meta.name ?? source.split("/").pop()!.replace(/\.md$/, "");
  const description = meta.description ?? `Cursor subagent for ${name} generated from shared doctrine.`;
  const relSource = relative(REPO_DIR, source).replace(/\\/g, "/");
  const target = join(CURSOR_AGENTS_DIR, `${name}.md`);
  const sourceBody = transformCursorAgentBody(body);
  const agent = `---
name: ${name}
${yamlBlock("description", description)}
---

${CURSOR_AGENT_MARKER}${relSource} -->

${sourceBody}`;
  return [
    target,
    agent,
    { kind: "agent", source: relSource, target: relative(REPO_DIR, target).replace(/\\/g, "/"), name, source_sha256: sha256(raw), target_sha256: sha256(agent) },
  ];
}

function generatedCursorSkill(source: string): [string, string, Record<string, string>] {
  const raw = readText(source);
  const { meta, body } = parseFrontmatter(raw);
  const name = meta.name ?? source.split("/").pop()!.replace(/\.md$/, "");
  const description = meta.description ?? `Cursor skill for ${name} generated from shared doctrine.`;
  const relSource = relative(REPO_DIR, source).replace(/\\/g, "/");
  const target = join(CURSOR_SKILLS_DIR, name, "SKILL.md");
  const sourceBody = transformCursorAgentBody(body);
  const skill = `---
name: ${name}
${yamlBlock("description", description)}
---

${CURSOR_SKILL_MARKER}${relSource} -->

# ${titleize(name)}

This Cursor skill is generated from \`${relSource}\`. Do not edit it by hand; update the shared agent source and run \`./sync.sh generate-cursor-agents\`.

## Cursor Runtime Notes

- Treat this as the Cursor-native form of the shared \`${name}\` agent.
- Claude-specific \`tools\` and \`model\` frontmatter from the source file is provenance, not a Cursor runtime contract.
- Read \`~/.cursor/TENETS.md\` when the source agent asks for the shared engineering contract.
- Preserve any read-only constraint from the source agent: propose, review, and verify, but do not mutate files when the agent says it is read-only.

## Agent Instructions

${sourceBody}`;
  return [
    target,
    skill,
    { kind: "skill", source: relSource, target: relative(REPO_DIR, target).replace(/\\/g, "/"), name, source_sha256: sha256(raw), target_sha256: sha256(skill) },
  ];
}

function desiredCursorOutputs(): [string, string, Record<string, string>][] {
  if (!existsSync(AGENTS_DIR)) return [];
  const items: [string, string, Record<string, string>][] = [];
  for (const f of readdirSync(AGENTS_DIR).filter((n) => n.endsWith(".md")).sort()) {
    const path = join(AGENTS_DIR, f);
    items.push(generatedCursorAgent(path), generatedCursorSkill(path));
  }
  return items;
}

function generatedCursorExisting(marker: string, root: string, pattern: RegExp): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const path of walkFiles(root)) {
    if (pattern.test(path) && readText(path).includes(marker)) out.push(path);
  }
  return out;
}

export function cursorAgentReflectPreview(): void {
  const items = desiredCursorOutputs();
  const [patch, statuses] = buildMultiDiff(items, () => [
    ...generatedCursorExisting(CURSOR_AGENT_MARKER, CURSOR_AGENTS_DIR, /\.md$/),
    ...generatedCursorExisting(CURSOR_SKILL_MARKER, CURSOR_SKILLS_DIR, /SKILL\.md$/),
  ]);
  writeText(CURSOR_AGENT_PATCH, patch);
  writeText(CURSOR_AGENT_STATUSES, `${JSON.stringify(statuses, null, 2)}\n`);
  const changed = statuses.filter((s) => s.status !== "unchanged");
  const rationale = `Generated ${items.length} Cursor agent/skill target(s) from shared agents/*.md. ${changed.length} target(s) need changes.`;
  writeText(CURSOR_AGENT_RATIONALE, `${rationale}\n`);
  log("cursor-agent-reflect", rationale);
  if (patch) process.stdout.write(patch);
}

export function cursorAgentReflectApply(): void {
  const items = desiredCursorOutputs();
  const [, statuses] = buildMultiDiff(items, () => [
    ...generatedCursorExisting(CURSOR_AGENT_MARKER, CURSOR_AGENTS_DIR, /\.md$/),
    ...generatedCursorExisting(CURSOR_SKILL_MARKER, CURSOR_SKILLS_DIR, /SKILL\.md$/),
  ]);
  const now = new Date().toISOString();
  let changed = 0;
  const desiredTargets = new Set(items.map(([t]) => t));
  for (const [target, desired, meta] of items) {
    if (readText(target) !== desired) {
      writeText(target, desired);
      changed++;
      writeLedger(CURSOR_AGENT_LEDGER, { timestamp: now, action: "write", ...meta });
      log("cursor-agent-reflect", `wrote ${relative(REPO_DIR, target)}`);
    }
  }
  for (const obsolete of generatedCursorExisting(CURSOR_AGENT_MARKER, CURSOR_AGENTS_DIR, /\.md$/)) {
    if (desiredTargets.has(obsolete)) continue;
    const rel = relative(REPO_DIR, obsolete).replace(/\\/g, "/");
    unlinkSync(obsolete);
    changed++;
    writeLedger(CURSOR_AGENT_LEDGER, { timestamp: now, action: "delete", target: rel });
    log("cursor-agent-reflect", `deleted obsolete ${rel}`);
  }
  for (const obsolete of generatedCursorExisting(CURSOR_SKILL_MARKER, CURSOR_SKILLS_DIR, /SKILL\.md$/)) {
    if (desiredTargets.has(obsolete)) continue;
    const rel = relative(REPO_DIR, obsolete).replace(/\\/g, "/");
    unlinkSync(obsolete);
    changed++;
    writeLedger(CURSOR_AGENT_LEDGER, { timestamp: now, action: "delete", target: rel });
    log("cursor-agent-reflect", `deleted obsolete ${rel}`);
  }
  if (!changed) log("cursor-agent-reflect", "generated Cursor agents/skills are already current");
  writeText(CURSOR_AGENT_STATUSES, `${JSON.stringify(statuses, null, 2)}\n`);
}

// --- codex agents md reflect ---

const CODEX_AGENTS_MD_PATCH = process.env.CODEX_AGENTS_MD_REFLECT_PATCH ?? join(REPO_DIR, ".codex-agents-md-reflect.patch");
const CODEX_AGENTS_MD_RATIONALE = process.env.CODEX_AGENTS_MD_REFLECT_RATIONALE ?? join(REPO_DIR, ".codex-agents-md-reflect.rationale");
const CODEX_AGENTS_MD_STATUSES = process.env.CODEX_AGENTS_MD_REFLECT_STATUSES ?? join(REPO_DIR, ".codex-agents-md-reflect.statuses.json");
const CODEX_AGENTS_MD_LEDGER = process.env.CODEX_AGENTS_MD_REFLECT_LEDGER ?? join(REPO_DIR, "codex-agents-md-reflect-ledger.jsonl");
const CODEX_AGENTS_MARKER = "<!-- GENERATED-CODEX-AGENTS: source=CLAUDE.md+hosts/codex.md+delegation.toml -->";
const CODEX_HEADER_END_MARKER = "<!-- CODEX-FROZEN-HEADER:END -->";
const CODEX_HEADER_SENTINEL = "This file is synced from the shared `claude-md` doctrine repo. It is the Codex-native entrypoint; do not replace it with a pointer to `~/.claude/CLAUDE.md`.";

function pathRewriteCodex(body: string): string {
  return rewritePaths(body, "codex", false);
}

export function codexFrozenHeader(currentAgents: string): string {
  const markerCount = currentAgents.split(CODEX_HEADER_END_MARKER).length - 1;
  if (markerCount > 1) throw new Error(`codex/AGENTS.md: expected at most one frozen header boundary, found ${markerCount}`);
  const headerMarkerAt = currentAgents.indexOf(CODEX_HEADER_END_MARKER);
  const sentinelAt = currentAgents.indexOf(CODEX_HEADER_SENTINEL);
  const headerEnd = headerMarkerAt >= 0
    ? headerMarkerAt
    : sentinelAt >= 0
      ? sentinelAt + CODEX_HEADER_SENTINEL.length
      : -1;
  if (headerEnd === -1) throw new Error("codex/AGENTS.md: cannot find frozen header boundary");
  return currentAgents.slice(0, headerEnd).replace(/\s+$/, "");
}

export function generatedCodexAgentsMd(): [string, string, Record<string, string>] {
  const target = join(REPO_DIR, "codex", "AGENTS.md");
  const frozenHeader = codexFrozenHeader(readText(target));
  const rendered = pathRewriteCodex(composeHostDoctrine("codex"));
  const output = `${frozenHeader}\n\n${CODEX_HEADER_END_MARKER}\n\n${CODEX_AGENTS_MARKER}\n\n${rendered}`;
  return [
    target,
    output,
    { source: "CLAUDE.md+hosts/codex.md+delegation.toml", target: "codex/AGENTS.md", source_sha256: sha256(rendered), target_sha256: sha256(output) },
  ];
}

export function codexAgentsMdReflectPreview(): void {
  const [target, desired, meta] = generatedCodexAgentsMd();
  const current = readText(target);
  const status = current === desired ? "unchanged" : existsSync(target) ? "update" : "create";
  const patch =
    current !== desired
      ? unifiedDiff(current.replace(/\n$/, ""), desired.replace(/\n$/, ""), `a/${meta.target}`, `b/${meta.target}`)
      : "";
  writeText(CODEX_AGENTS_MD_PATCH, patch || "NO_CHANGES\n");
  writeText(CODEX_AGENTS_MD_STATUSES, `${JSON.stringify([{ ...meta, status }], null, 2)}\n`);
  const rationale = `Generated codex/AGENTS.md from CLAUDE.md, hosts/codex.md, and delegation.toml (${status}).`;
  writeText(CODEX_AGENTS_MD_RATIONALE, `${rationale}\n`);
  log("codex-agents-md-reflect", rationale);
  if (patch) process.stdout.write(patch);
}

export function codexAgentsMdReflectApply(): void {
  const [target, desired, meta] = generatedCodexAgentsMd();
  const current = readText(target);
  if (current === desired) {
    log("codex-agents-md-reflect", "codex/AGENTS.md is already current");
    writeText(CODEX_AGENTS_MD_STATUSES, `${JSON.stringify([{ ...meta, status: "unchanged" }], null, 2)}\n`);
    return;
  }
  writeText(target, desired);
  writeLedger(CODEX_AGENTS_MD_LEDGER, { timestamp: new Date().toISOString(), action: "write", ...meta });
  log("codex-agents-md-reflect", `wrote ${meta.target}`);
  writeText(CODEX_AGENTS_MD_STATUSES, `${JSON.stringify([{ ...meta, status: "update" }], null, 2)}\n`);
}
