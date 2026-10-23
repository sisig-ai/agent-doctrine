import { existsSync, readdirSync, rmSync, unlinkSync } from "fs";
import { join } from "path";
import { parse, stringify } from "smol-toml";
import {
  CLAUDE_TARGET,
  CODEX_TARGET,
  CURSOR_TARGET,
  GROK_TARGET,
  MUSE_TARGET,
  OPENCODE_TARGET,
  REPO_DIR,
  SHARED_FILES,
  capture,
  composeWithLocalBlock,
  copyFile,
  copySharedSkills,
  copyTree,
  extractLocalBlock,
  fileDifferent,
  log,
  newer,
  readText,
  stripLocalBlock,
  writeText,
} from "./lib.ts";
import {
  codexAgentsMdReflectApply,
  codexAgentsMdReflectPreview,
  cursorRuleReflectApply,
  cursorRuleReflectPreview,
  generatedClaudeDoctrine,
  generatedGrokRule,
  generatedMuseAgentsMd,
  opencodeAgentReflectApply,
  opencodeAgentReflectPreview,
  opencodeAgentsMdReflectApply,
  opencodeAgentsMdReflectPreview,
  renderGrokDoctrine,
  renderMuseDoctrine,
} from "./generators.ts";
import {
  HANDOFF_PLUGIN_DIR,
  deployHandoffCore,
  ensureClaudeStyleHook,
  ensureCodexStyleHook,
  ensureCursorStyleHooks,
} from "./host-hooks.ts";
import { runPersonalRulesSync } from "./personal-rules.ts";
import { MachineLocalError, reconcileMachineLocal } from "./machine-local.ts";

export function reconcileMachineLocalOrExit(): void {
  try {
    reconcileMachineLocal();
  } catch (e) {
    if (e instanceof MachineLocalError) {
      console.error(`[doctrine-sync] ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

export function syncVerbatimFile(repoRel: string, targetRoot: string, direction: string, logLabel?: string): void {
  const label = logLabel ?? repoRel;
  const repoFile = join(REPO_DIR, repoRel);
  const targetFile = join(targetRoot, repoRel);
  if (direction === "pull") copyFile(repoFile, targetFile);
  else if (direction === "push") copyFile(targetFile, repoFile);
  else if (direction === "sync") {
    if (existsSync(targetFile) && existsSync(repoFile) && fileDifferent(targetFile, repoFile)) {
      if (newer(targetFile, repoFile)) {
        log(`${label}: local is newer -> repo`);
        copyFile(targetFile, repoFile);
      } else {
        log(`${label}: remote is newer -> local`);
        copyFile(repoFile, targetFile);
      }
    } else if (existsSync(targetFile) && !existsSync(repoFile)) {
      log(`${label}: only local exists -> repo`);
      copyFile(targetFile, repoFile);
    } else if (existsSync(repoFile) && !existsSync(targetFile)) {
      log(`${label}: only remote exists -> local`);
      copyFile(repoFile, targetFile);
    }
  } else throw new Error(direction);
}

export function syncLocalBlockFile(
  repoFile: string,
  targetFile: string,
  label: string,
  direction: string,
  opts?: { allowLegacyCodex?: boolean },
): void {
  const targetText = readText(targetFile);
  const legacyWithoutSharedBody = Boolean(
    opts?.allowLegacyCodex &&
      extractLocalBlock(targetText, { allowLegacyCodex: true }) &&
      !targetText.includes("# Codex Global Instructions"),
  );
  if (direction === "pull") {
    composeWithLocalBlock(targetFile, repoFile, opts);
    return;
  }
  if (direction === "push") {
    if (existsSync(targetFile)) {
      if (legacyWithoutSharedBody) {
        log(`${label}: legacy local-only block found; pull once before pushing`);
        return;
      }
      writeText(repoFile, stripLocalBlock(readText(targetFile), opts));
    }
    return;
  }
  if (existsSync(targetFile) && existsSync(repoFile)) {
    const localBody = legacyWithoutSharedBody ? readText(repoFile) : stripLocalBlock(targetText, opts);
    const repoBody = readText(repoFile);
    if (localBody !== repoBody) {
      if (newer(targetFile, repoFile)) {
        log(`${label}: local shared body newer -> repo`);
        writeText(repoFile, localBody);
      } else {
        log(`${label}: remote newer -> local (local block preserved)`);
        composeWithLocalBlock(targetFile, repoFile, opts);
      }
    }
  } else if (existsSync(targetFile)) {
    log(`${label}: only local exists -> repo (shared body)`);
    writeText(repoFile, stripLocalBlock(readText(targetFile), opts));
  } else if (existsSync(repoFile)) {
    log(`${label}: only remote exists -> local`);
    composeWithLocalBlock(targetFile, repoFile, opts);
  }
}

export function syncClaude(direction: string): void {
  const target = join(CLAUDE_TARGET, "CLAUDE.md");
  const desired = generatedClaudeDoctrine();
  const targetExists = existsSync(target);
  const targetMatches = targetExists && stripLocalBlock(readText(target)) === desired;
  if (direction === "push" && !targetExists) {
    throw new Error("push-claude: ~/.claude/CLAUDE.md is missing; run pull-claude first");
  }
  if ((direction === "push" || direction === "sync") && targetExists && !targetMatches) {
    throw new Error("~/.claude/CLAUDE.md is generated and differs from its source; run pull-claude to replace it");
  }
  for (const rel of SHARED_FILES) syncVerbatimFile(rel, CLAUDE_TARGET, direction);
  if (direction === "pull" || (direction === "sync" && !targetExists)) {
    const block = extractLocalBlock(readText(target));
    writeText(target, block ? `${block}\n${desired}` : desired);
  }
  if (direction === "pull" || direction === "sync") {
    copyTree(join(REPO_DIR, "claude", "skills"), join(CLAUDE_TARGET, "skills"));
    copyTree(join(REPO_DIR, "claude", "agents"), join(CLAUDE_TARGET, "agents"));
    copySharedSkills(CLAUDE_TARGET);
    ensureClaudeStyleHook();
    deployHandoffCore(CLAUDE_TARGET);
  } else if (direction === "push") {
    log("claude skills are repo-managed; not copying ~/.claude/skills back to repo");
  }
  reconcileMachineLocalOrExit();
}

export function syncCursor(direction: string): void {
  for (const rel of ["TASTE.md", "TENETS.md", "HANDOFFS.md", "style-reminder.md"]) {
    syncVerbatimFile(rel, CURSOR_TARGET, direction, `cursor/${rel}`);
  }
  syncLocalBlockFile(
    join(REPO_DIR, "cursor", "rules", "doctrine.mdc"),
    join(CURSOR_TARGET, "rules", "doctrine.mdc"),
    "cursor/rules/doctrine.mdc",
    direction,
  );
  if (direction === "pull" || direction === "sync") {
    copyFile(join(REPO_DIR, "cursor", "rules", "project-memory.mdc"), join(CURSOR_TARGET, "rules", "project-memory.mdc"));
    copyTree(join(REPO_DIR, "cursor", "agents"), join(CURSOR_TARGET, "agents"));
    copyTree(join(REPO_DIR, "cursor", "skills"), join(CURSOR_TARGET, "skills"));
    copySharedSkills(CURSOR_TARGET);
    ensureCursorStyleHooks();
    runPersonalRulesSync("apply-mcp");
  } else if (direction === "push") {
    log("cursor agents/skills are repo-managed; not copying ~/.cursor/skills back to repo");
  }
  reconcileMachineLocalOrExit();
}

export function ensureDelegationRenders(): void {
  codexAgentsMdReflectPreview();
  codexAgentsMdReflectApply();
  cursorRuleReflectPreview();
  cursorRuleReflectApply();
  opencodeAgentsMdReflectPreview();
  opencodeAgentsMdReflectApply();
  opencodeAgentReflectPreview();
  opencodeAgentReflectApply();
  renderGrokDoctrine();
  renderMuseDoctrine();
}

function asTomlTable(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`grok config.toml: ${label} must be a table`);
  }
  return value as Record<string, unknown>;
}

export function writeGrokCompatFlags(path: string): void {
  if (!existsSync(path)) {
    log(`grok config.toml is absent; compat flags skipped: ${path}`);
    return;
  }
  const raw = readText(path);
  if (!raw.trim()) throw new Error(`grok config.toml parse failed: ${path} is empty`);
  let data: Record<string, unknown>;
  try {
    data = parse(raw) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`grok config.toml parse failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (data.compat !== undefined) asTomlTable(data.compat, "[compat]");
  const compat = (data.compat ??= {}) as Record<string, unknown>;
  if (compat.claude !== undefined) asTomlTable(compat.claude, "[compat.claude]");
  if (compat.cursor !== undefined) asTomlTable(compat.cursor, "[compat.cursor]");
  const claude = (compat.claude ??= {}) as Record<string, unknown>;
  const cursor = (compat.cursor ??= {}) as Record<string, unknown>;
  claude.agents = false;
  claude.rules = false;
  cursor.agents = false;
  cursor.rules = false;
  writeText(path, stringify(data));
}

const GROK_OBSOLETE_AGENTS = ["implementer-light.md"];

export function syncGrok(direction: "pull" | "push" | "sync"): void {
  if (direction === "pull" || direction === "sync") renderGrokDoctrine();
  const targetRule = join(GROK_TARGET, "rules", "doctrine.md");
  const desired = generatedGrokRule()[1];
  const targetExists = existsSync(targetRule);
  const targetMatches = targetExists && stripLocalBlock(readText(targetRule)) === desired;
  if (direction === "push" && !targetExists) {
    throw new Error("push-grok: ~/.grok/rules/doctrine.md is missing; run pull-grok first");
  }
  if ((direction === "push" || direction === "sync") && targetExists && !targetMatches) {
    throw new Error("~/.grok/rules/doctrine.md is generated and differs from its source; run pull-grok to replace it");
  }
  for (const rel of ["TASTE.md", "TENETS.md", "HANDOFFS.md"]) {
    syncVerbatimFile(rel, GROK_TARGET, direction, `grok/${rel}`);
  }
  if (direction === "pull" || (direction === "sync" && !targetExists)) {
    const block = extractLocalBlock(readText(targetRule));
    writeText(targetRule, block ? `${block}\n${desired}` : desired);
  }
  if (direction === "pull" || direction === "sync") {
    copyTree(join(REPO_DIR, "grok", "agents"), join(GROK_TARGET, "agents"));
    for (const name of GROK_OBSOLETE_AGENTS) {
      const obsolete = join(GROK_TARGET, "agents", name);
      if (existsSync(obsolete)) unlinkSync(obsolete);
    }
    copySharedSkills(GROK_TARGET);
    writeGrokCompatFlags(join(GROK_TARGET, "config.toml"));
  } else if (direction === "push") {
    log("grok agents are repo-managed; not copying ~/.grok/agents back to repo");
  }
  reconcileMachineLocalOrExit();
}

export function syncMuse(direction: "pull" | "push" | "sync"): void {
  if (direction === "pull" || direction === "sync") renderMuseDoctrine();
  const targetFile = join(MUSE_TARGET, "AGENTS.md");
  const desired = generatedMuseAgentsMd()[1];
  const targetExists = existsSync(targetFile);
  const targetMatches = targetExists && stripLocalBlock(readText(targetFile)) === desired;
  if (direction === "push" && !targetExists) {
    throw new Error("push-muse: ~/.config/muse/AGENTS.md is missing; run pull-muse first");
  }
  if ((direction === "push" || direction === "sync") && targetExists && !targetMatches) {
    throw new Error("~/.config/muse/AGENTS.md is generated and differs from its source; run pull-muse to replace it");
  }
  for (const rel of ["TASTE.md", "TENETS.md", "HANDOFFS.md"]) {
    syncVerbatimFile(rel, MUSE_TARGET, direction, `muse/${rel}`);
  }
  if (direction === "pull" || (direction === "sync" && !targetExists)) {
    const block = extractLocalBlock(readText(targetFile));
    writeText(targetFile, block ? `${block}\n${desired}` : desired);
  }
  if (direction === "pull" || direction === "sync") copySharedSkills(MUSE_TARGET);
  reconcileMachineLocalOrExit();
}

export function syncCodex(direction: string): void {
  const agentsRepo = join(REPO_DIR, "codex", "AGENTS.md");
  const agentsTarget = join(CODEX_TARGET, "AGENTS.md");
  if (direction === "push") {
    if (!existsSync(agentsTarget)) {
      console.error("push-codex: ~/.codex/AGENTS.md is missing; run pull-codex first");
      process.exit(1);
    }
    if (!existsSync(agentsRepo)) {
      console.error("push-codex: repo codex/AGENTS.md is missing; run generate-delegation first");
      process.exit(1);
    }
    const localBody = stripLocalBlock(readText(agentsTarget), { allowLegacyCodex: true });
    const repoBody = readText(agentsRepo);
    if (localBody !== repoBody) {
      console.error(
        "push-codex: ~/.codex/AGENTS.md shared body differs from repo codex/AGENTS.md; codex/AGENTS.md is generated from CLAUDE.md+delegation.toml — do not edit locally. Run pull-codex to sync.",
      );
      process.exit(1);
    }
  }
  for (const rel of SHARED_FILES) syncVerbatimFile(rel, CODEX_TARGET, direction);
  const codexClaude = join(CODEX_TARGET, "CLAUDE.md");
  if (existsSync(codexClaude)) {
    log("deleting ~/.codex/CLAUDE.md (superseded by ~/.codex/AGENTS.md)");
    unlinkSync(codexClaude);
  }
  if (direction === "pull" || direction === "sync") {
    codexAgentsMdReflectPreview();
    codexAgentsMdReflectApply();
    composeWithLocalBlock(agentsTarget, agentsRepo, { allowLegacyCodex: true });
    copyTree(join(REPO_DIR, "codex", "skills"), join(CODEX_TARGET, "skills"));
    copySharedSkills(CODEX_TARGET);
    ensureCodexStyleHook();
  } else if (direction === "push") {
    log("codex skills are repo-managed; not copying ~/.codex/skills back to repo");
  }
  reconcileMachineLocalOrExit();
}

// Copy repo-managed opencode plugin sources into the host plugin dir and install
// each plugin's dependencies with its committed lockfile. A non-zero install
// throws, so a plugin never loads with missing packages. The `handoff` guard is
// local-only: ordinary sync never activates it, so a porch-only host stays clean.
// Two retired plugins injected content on every model call. Copy code never
// deletes target files, so an earlier sync leaves them live on an installed
// host. Remove both target directories before the copy work.
const RETIRED_OPENCODE_PLUGINS = ["style-reminder", "honcho-main-only"];

// Copy code never deletes target files. The shared doctrine-review skill replaced
// the opencode-only adv-review skill, so remove the stale target directory.
const OPENCODE_OBSOLETE_SKILLS = ["adv-review"];

export function removeObsoleteOpencodeSkills(): void {
  for (const name of OPENCODE_OBSOLETE_SKILLS) {
    rmSync(join(OPENCODE_TARGET, "skills", name), { recursive: true, force: true });
  }
}

export function installOpencodePlugins(): void {
  const source = join(REPO_DIR, "opencode", "plugins");
  const target = join(OPENCODE_TARGET, "plugins");
  for (const name of RETIRED_OPENCODE_PLUGINS) {
    rmSync(join(target, name), { recursive: true, force: true });
  }
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === HANDOFF_PLUGIN_DIR) continue;
    copyTree(join(source, entry.name), join(target, entry.name));
  }
  if (!existsSync(target)) return;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(target, entry.name);
    if (!existsSync(join(dir, "package.json"))) continue;
    capture(["bun", "install", "--frozen-lockfile", "--production"], dir);
  }
}

export function syncOpencode(direction: string): void {
  const agentsRepo = join(REPO_DIR, "opencode", "AGENTS.md");
  const agentsTarget = join(OPENCODE_TARGET, "AGENTS.md");
  if (direction === "push") {
    if (!existsSync(agentsTarget)) {
      console.error("push-opencode: ~/.config/opencode/AGENTS.md is missing; run pull-opencode first");
      process.exit(1);
    }
    if (!existsSync(agentsRepo)) {
      console.error("push-opencode: repo opencode/AGENTS.md is missing; run generate-opencode-agents-md first");
      process.exit(1);
    }
    const localBody = stripLocalBlock(readText(agentsTarget));
    const repoBody = readText(agentsRepo);
    if (localBody !== repoBody) {
      console.error(
        "push-opencode: ~/.config/opencode/AGENTS.md shared body differs from repo opencode/AGENTS.md; opencode/AGENTS.md is generated from CLAUDE.md+delegation.toml — do not edit locally. Run pull-opencode to sync.",
      );
      process.exit(1);
    }
  }
  for (const rel of ["TASTE.md", "TENETS.md", "HANDOFFS.md"]) {
    syncVerbatimFile(rel, OPENCODE_TARGET, direction, `opencode/${rel}`);
  }
  const retiredReminder = join(OPENCODE_TARGET, "style-reminder.md");
  if (existsSync(retiredReminder)) unlinkSync(retiredReminder);
  if (direction === "pull" || direction === "sync") {
    opencodeAgentsMdReflectPreview();
    opencodeAgentsMdReflectApply();
    composeWithLocalBlock(agentsTarget, agentsRepo);
    opencodeAgentReflectPreview();
    opencodeAgentReflectApply();
    copyTree(join(REPO_DIR, "opencode", "agents"), join(OPENCODE_TARGET, "agents"));
    copyTree(join(REPO_DIR, "opencode", "skills"), join(OPENCODE_TARGET, "skills"));
    copySharedSkills(OPENCODE_TARGET);
    removeObsoleteOpencodeSkills();
    copyTree(join(REPO_DIR, "opencode", "commands"), join(OPENCODE_TARGET, "commands"));
    installOpencodePlugins();
    deployHandoffCore(OPENCODE_TARGET);
  } else if (direction === "push") {
    log("opencode agents/skills/commands are repo-managed; not copying ~/.config/opencode back to repo");
    log("opencode config (opencode.jsonc) is never copied back to repo");
  }
  reconcileMachineLocalOrExit();
}
