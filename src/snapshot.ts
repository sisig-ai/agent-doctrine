import { existsSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import {
  AMP_TARGET,
  CLAUDE_TARGET,
  CODEX_TARGET,
  CURSOR_TARGET,
  GROK_TARGET,
  MUSE_TARGET,
  OPENCODE_TARGET,
  REPO_DIR,
  SHARED_FILES,
  composeWithLocalBlock,
  copyFile,
  copySharedSkills,
  copyTree,
  extractLocalBlock,
  gitOut,
  installWrappers,
  readText,
  remotePull,
  stripLocalBlock,
  writeText,
} from "./lib.ts";
import { generatedClaudeDoctrine, renderMuseDoctrine } from "./generators.ts";
import {
  deployHandoffCore,
  ensureClaudeStyleHook,
  ensureCodexStyleHook,
  ensureCursorStyleHooks,
  installAmpStyleReminder,
} from "./host-hooks.ts";
import { installOpencodePlugins, reconcileMachineLocalOrExit, removeObsoleteOpencodeSkills } from "./host-sync.ts";
import { runPersonalRulesSync } from "./personal-rules.ts";
import { machineLocalStatus } from "./machine-local.ts";
import * as pm from "./project-memory.ts";

export function printStatus(): void {
  if (!process.env.CLAUDE_MD_SNAPSHOT) remotePull();
  console.log(`repo:          ${REPO_DIR}`);
  console.log(`claude target:   ${CLAUDE_TARGET}`);
  console.log(`codex target:    ${CODEX_TARGET}`);
  console.log(`cursor target:   ${CURSOR_TARGET}`);
  console.log(`opencode target: ${OPENCODE_TARGET}`);
  console.log(`grok target:     ${GROK_TARGET}`);
  console.log(`muse target:     ${MUSE_TARGET}`);
  console.log("machine LOCAL.md:");
  for (const line of machineLocalStatus().split("\n")) {
    console.log(`  ${line}`);
  }
  try {
    const memoryStatus = pm.status(REPO_DIR);
    console.log(`project memory: ${memoryStatus.registered} registered`);
    for (const project of memoryStatus.projects as Record<string, unknown>[]) {
      console.log(`  project-memory/${project.project_id}: ${pm.canonicalJson(project).toString("utf-8")}`);
    }
  } catch (e) {
    console.log(`project memory: registry ERROR (${e})`);
  }
  console.log();
  if (process.env.CLAUDE_MD_SNAPSHOT) console.log("snapshot:       read-only");
  else process.stdout.write(gitOut("status", "-sb"));
  const claudeTarget = join(CLAUDE_TARGET, "CLAUDE.md");
  if (existsSync(claudeTarget)) {
    let marker = stripLocalBlock(readText(claudeTarget)) === generatedClaudeDoctrine() ? "generated body in sync" : "generated body DIFFERS";
    if (extractLocalBlock(readText(claudeTarget))) marker += " (local-only block present)";
    console.log(`  CLAUDE.md: ${marker}`);
  } else {
    console.log("  CLAUDE.md: missing target");
  }
  for (const [label, target, repoFile, allowLegacy] of [
    ["codex/AGENTS.md", join(CODEX_TARGET, "AGENTS.md"), join(REPO_DIR, "codex", "AGENTS.md"), true],
    ["cursor/rules/doctrine.mdc", join(CURSOR_TARGET, "rules", "doctrine.mdc"), join(REPO_DIR, "cursor", "rules", "doctrine.mdc"), false],
    ["opencode/AGENTS.md", join(OPENCODE_TARGET, "AGENTS.md"), join(REPO_DIR, "opencode", "AGENTS.md"), false],
    ["grok/rules/doctrine.md", join(GROK_TARGET, "rules", "doctrine.md"), join(REPO_DIR, "grok", "rules", "doctrine.md"), false],
    ["muse/AGENTS.md", join(MUSE_TARGET, "AGENTS.md"), join(REPO_DIR, "muse", "AGENTS.md"), false],
  ] as const) {
    if (existsSync(target) && existsSync(repoFile)) {
      let marker =
        stripLocalBlock(readText(target), { allowLegacyCodex: allowLegacy }) === readText(repoFile)
          ? "shared body in sync"
          : "shared body DIFFERS";
      if (extractLocalBlock(readText(target), { allowLegacyCodex: allowLegacy })) marker += " (local-only block present)";
      console.log(`  ${label}: ${marker}`);
    } else {
      console.log(`  ${label}: missing on one side`);
    }
  }
}

export function applySnapshot(): void {
  if (!process.env.CLAUDE_MD_DIR) throw new Error("apply-snapshot requires CLAUDE_MD_DIR");
  if (!existsSync(REPO_DIR) || !statSync(REPO_DIR).isDirectory()) {
    throw new Error(`apply-snapshot source is not a directory: ${REPO_DIR}`);
  }
  for (const required of ["CLAUDE.md", "TASTE.md", "TENETS.md", "HANDOFFS.md", "delegation.toml"]) {
    if (!existsSync(join(REPO_DIR, required))) throw new Error(`apply-snapshot source is missing ${required}`);
  }

  for (const rel of SHARED_FILES) copyFile(join(REPO_DIR, rel), join(CLAUDE_TARGET, rel));
  const claudeTarget = join(CLAUDE_TARGET, "CLAUDE.md");
  const claudeLocal = extractLocalBlock(readText(claudeTarget));
  const claudeDoctrine = generatedClaudeDoctrine();
  writeText(claudeTarget, claudeLocal ? `${claudeLocal}\n${claudeDoctrine}` : claudeDoctrine);
  copyTree(join(REPO_DIR, "claude", "skills"), join(CLAUDE_TARGET, "skills"));
  copyTree(join(REPO_DIR, "claude", "agents"), join(CLAUDE_TARGET, "agents"));
  copySharedSkills(CLAUDE_TARGET);
  ensureClaudeStyleHook();
  deployHandoffCore(CLAUDE_TARGET);

  for (const rel of SHARED_FILES) copyFile(join(REPO_DIR, rel), join(CODEX_TARGET, rel));
  composeWithLocalBlock(join(CODEX_TARGET, "AGENTS.md"), join(REPO_DIR, "codex", "AGENTS.md"), {
    allowLegacyCodex: true,
  });
  copyTree(join(REPO_DIR, "codex", "skills"), join(CODEX_TARGET, "skills"));
  copySharedSkills(CODEX_TARGET);
  ensureCodexStyleHook();

  for (const rel of ["TASTE.md", "TENETS.md", "HANDOFFS.md", "style-reminder.md"]) {
    copyFile(join(REPO_DIR, rel), join(CURSOR_TARGET, rel));
  }
  composeWithLocalBlock(
    join(CURSOR_TARGET, "rules", "doctrine.mdc"),
    join(REPO_DIR, "cursor", "rules", "doctrine.mdc"),
  );
  copyFile(join(REPO_DIR, "cursor", "rules", "project-memory.mdc"), join(CURSOR_TARGET, "rules", "project-memory.mdc"));
  copyTree(join(REPO_DIR, "cursor", "agents"), join(CURSOR_TARGET, "agents"));
  copyTree(join(REPO_DIR, "cursor", "skills"), join(CURSOR_TARGET, "skills"));
  copySharedSkills(CURSOR_TARGET);
  ensureCursorStyleHooks();
  runPersonalRulesSync("apply-cli");

  for (const rel of ["TASTE.md", "TENETS.md", "HANDOFFS.md"]) {
    copyFile(join(REPO_DIR, rel), join(OPENCODE_TARGET, rel));
  }
  const retiredSnapshotReminder = join(OPENCODE_TARGET, "style-reminder.md");
  if (existsSync(retiredSnapshotReminder)) unlinkSync(retiredSnapshotReminder);
  composeWithLocalBlock(join(OPENCODE_TARGET, "AGENTS.md"), join(REPO_DIR, "opencode", "AGENTS.md"));
  copyTree(join(REPO_DIR, "opencode", "agents"), join(OPENCODE_TARGET, "agents"));
  copyTree(join(REPO_DIR, "opencode", "skills"), join(OPENCODE_TARGET, "skills"));
  copySharedSkills(OPENCODE_TARGET);
  removeObsoleteOpencodeSkills();
  copyTree(join(REPO_DIR, "opencode", "commands"), join(OPENCODE_TARGET, "commands"));
  installOpencodePlugins();
  deployHandoffCore(OPENCODE_TARGET);

  for (const rel of ["TASTE.md", "TENETS.md", "HANDOFFS.md"]) {
    copyFile(join(REPO_DIR, rel), join(MUSE_TARGET, rel));
  }
  renderMuseDoctrine();
  composeWithLocalBlock(join(MUSE_TARGET, "AGENTS.md"), join(REPO_DIR, "muse", "AGENTS.md"));
  copySharedSkills(MUSE_TARGET);
  copySharedSkills(GROK_TARGET);

  installAmpStyleReminder();

  reconcileMachineLocalOrExit();
  installWrappers(join(CLAUDE_TARGET, "..", ".local", "bin"), REPO_DIR);
  console.log(`Applied read-only doctrine snapshot from ${REPO_DIR}.`);
  printStatus();
}
