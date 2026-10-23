#!/usr/bin/env bun
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { CODEX_TARGET, CURSOR_TARGET, REPO_DIR, copyTree, ensureRepo, isSymlink, log, remotePull, stageAndPushPaths, installWrappers } from "./lib.ts";
import {
  agentReflectApply,
  agentReflectPreview,
  codexAgentsMdReflectApply,
  codexAgentsMdReflectPreview,
  cursorAgentReflectApply,
  cursorAgentReflectPreview,
  cursorRuleReflectPreview,
  opencodeAgentReflectApply,
  opencodeAgentReflectPreview,
  opencodeAgentsMdReflectApply,
  opencodeAgentsMdReflectPreview,
} from "./generators.ts";
import { handoffCapabilities, installAmpStyleReminder, installHandoffLocal } from "./host-hooks.ts";
import {
  ensureDelegationRenders,
  reconcileMachineLocalOrExit,
  syncClaude,
  syncCodex,
  syncCursor,
  syncGrok,
  syncMuse,
  syncOpencode,
} from "./host-sync.ts";
import { runCodexMemoryReflect, runCursorMemoryReflect, runMemoryReflect } from "./memory-reflect.ts";
import { runPersonalRulesSync } from "./personal-rules.ts";
import { applySnapshot, printStatus } from "./snapshot.ts";
import * as pm from "./project-memory.ts";

interface ParsedArgs {
  command: string;
  projectId?: string;
  projectCheckout?: string;
  nativeMemory?: string;
  delete: string[];
  approvalHash?: string;
  claudeBin?: string;
  model?: string;
  sharedRoot: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: "sync-claude", delete: [], sharedRoot: false, json: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--delete") out.delete.push(argv[++i]!);
    else if (arg === "--approval-hash") out.approvalHash = argv[++i];
    else if (arg === "--claude-bin") out.claudeBin = argv[++i];
    else if (arg === "--model") out.model = argv[++i];
    else if (arg === "--shared-root") out.sharedRoot = true;
    else if (arg === "--json") out.json = true;
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (positional[0]) out.command = positional[0];
  if (positional[1]) out.projectId = positional[1];
  if (positional[2]) out.projectCheckout = positional[2];
  if (positional[3]) out.nativeMemory = positional[3];
  return out;
}

function stageAndPush(): boolean {
  return stageAndPushPaths(ensureDelegationRenders);
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const aliases: Record<string, string> = { pull: "pull-claude", push: "push-claude", sync: "sync-claude" };
  let command = aliases[args.command] ?? args.command;
  if (command === "project-memory") {
    if (args.projectId !== "path") {
      console.error("project-memory supports only the path router; use project-memory-<command> for mutations");
      process.exit(2);
    }
    command = "project-memory-path";
    args.projectId = args.projectCheckout;
  }
  if (command === "apply-snapshot") {
    applySnapshot();
    return 0;
  }
  if (process.env.CLAUDE_MD_SNAPSHOT && command !== "status") {
    throw new Error(`snapshot source is read-only; unsupported command: ${command}`);
  }
  if (!process.env.CLAUDE_MD_SNAPSHOT) ensureRepo();
  else if (!existsSync(REPO_DIR)) throw new Error(`snapshot source is missing: ${REPO_DIR}`);
  if (command === "install") {
    installWrappers();
    installAmpStyleReminder();
    reconcileMachineLocalOrExit();
    return 0;
  }
  if (command === "reconcile-local") {
    reconcileMachineLocalOrExit();
    console.log("Reconciled machine-local LOCAL.md across agent homes.");
    return 0;
  }
  if (command === "status") {
    printStatus();
    return 0;
  }
  if (command === "handoff-capabilities") {
    for (const cap of handoffCapabilities()) {
      console.log(`${cap.host}\t${cap.enforcement}\t${cap.detail}`);
    }
    return 0;
  }
  if (command === "install-handoff-local") {
    installHandoffLocal();
    return 0;
  }
  const projectCommands = new Set([
    "project-memory-register",
    "project-memory-path",
    "project-memory-status",
    "project-memory-preview",
    "project-memory-apply",
    "project-memory-pull",
  ]);
  const remotePullCommands = new Set([
    "pull-claude",
    "push-claude",
    "sync-claude",
    "pull-codex",
    "push-codex",
    "sync-codex",
    "pull-cursor",
    "push-cursor",
    "sync-cursor",
    "pull-opencode",
    "push-opencode",
    "sync-opencode",
    "pull-grok",
    "push-grok",
    "sync-grok",
    "pull-muse",
    "push-muse",
    "sync-muse",
    "pull-all",
    "sync-all",
    "reflect-claude-memory-preview",
    "reflect-claude-memory",
    "reflect-codex-memory-preview",
    "reflect-codex-memory",
    "reflect-cursor-memory-preview",
    "reflect-cursor-memory",
    "reflect-memory-preview",
    "reflect-memory",
    "export-cursor-personal-rules",
    "apply-cursor-personal-rules",
    "sync-cursor-personal-rules",
    "generate-codex-agents-preview",
    "generate-codex-agents",
    "generate-codex-agents-md-preview",
    "generate-codex-agents-md",
    "generate-cursor-rules-preview",
    "generate-cursor-rules",
    "generate-cursor-agents-preview",
    "generate-cursor-agents",
    "generate-opencode-agents-preview",
    "generate-opencode-agents",
    "generate-opencode-agents-md-preview",
    "generate-opencode-agents-md",
    "generate-delegation",
    "reflect-agents-preview",
    "reflect-agents",
    "reflect-cursor-agents-preview",
    "reflect-cursor-agents",
    "project-memory-register",
    "project-memory-status",
    "project-memory-preview",
    "project-memory-pull",
  ]);
  if (remotePullCommands.has(command) && remotePull() && !process.env.DOCTRINE_SYNC_REEXEC) {
    log("checkout moved during pull; re-running with the pulled code");
    const child = spawnSync(process.execPath, [import.meta.path, ...argv], {
      stdio: "inherit",
      env: { ...process.env, DOCTRINE_SYNC_REEXEC: "1" },
    });
    if (child.error) throw child.error;
    return child.status ?? 1;
  }
  if (projectCommands.has(command)) {
    const repo = REPO_DIR;
    if (command === "project-memory-register") {
      if (!args.projectId || !args.projectCheckout || !args.nativeMemory) {
        console.error("project-memory-register requires PROJECT_ID CHECKOUT NATIVE_MEMORY");
        process.exit(2);
      }
      pm.register(repo, args.projectId, args.projectCheckout, args.nativeMemory, { sharedRoot: args.sharedRoot });
      console.log(`registered: ${args.projectId}`);
    } else if (command === "project-memory-path") {
      const checkout = args.projectId ? resolve(args.projectId) : process.cwd();
      if (args.json) {
        const reg = pm.resolveProject(repo, checkout);
        if (!reg) return 0;
        const root = pm.memoryRoot(repo, reg.project_id);
        if (!existsSync(root) || isSymlink(root)) {
          throw new pm.ProjectMemoryError("registered canonical memory root is unreadable");
        }
        console.log(
          JSON.stringify({
            project_id: reg.project_id,
            canonical_memory: resolve(root),
            native_memory: pm.absoluteNative(reg.native_memory),
          }),
        );
      } else {
        const found = pm.projectPath(repo, checkout);
        if (found) console.log(found);
      }
    } else {
      if (!args.projectId) {
        console.error(`${command} requires PROJECT_ID`);
        process.exit(2);
      }
      const registration = pm.readRegistry()[args.projectId];
      if (!registration) {
        console.error(`unregistered project: ${args.projectId}`);
        process.exit(2);
      }
      if (command === "project-memory-status") {
        const report = pm.status(repo);
        console.log(pm.canonicalJson(report).toString("utf-8"));
      } else if (command === "project-memory-preview") {
        const artifact = pm.preview(repo, registration, { deletions: args.delete, claudeBinary: args.claudeBin, model: args.model });
        console.log(pm.canonicalJson(artifact).toString("utf-8"));
      } else if (command === "project-memory-pull") {
        console.log(`pulled: ${(await pm.pull(repo, registration)).join(", ")}`);
      } else {
        if (!args.approvalHash) {
          console.error("project-memory-apply requires --approval-hash");
          process.exit(2);
        }
        const changed = await pm.apply(repo, registration, args.approvalHash);
        console.log(`applied: ${changed.join(", ")}`);
      }
    }
    return 0;
  }
  if (command === "pull-claude") syncClaude("pull");
  else if (command === "push-claude") {
    syncClaude("push");
    ensureDelegationRenders();
    stageAndPush() || log("no local changes to push");
  } else if (command === "sync-claude") {
    syncClaude("sync");
    ensureDelegationRenders();
    stageAndPush() || log("synced; nothing new to push");
  } else if (command === "pull-codex") syncCodex("pull");
  else if (command === "push-codex") {
    syncCodex("push");
    agentReflectPreview();
    agentReflectApply();
    ensureDelegationRenders();
    stageAndPush() || log("no local changes to push");
  } else if (command === "sync-codex") {
    syncCodex("sync");
    agentReflectPreview();
    agentReflectApply();
    ensureDelegationRenders();
    copyTree(join(REPO_DIR, "codex", "skills"), join(CODEX_TARGET, "skills"));
    stageAndPush() || log("synced; nothing new to push");
  } else if (command === "pull-cursor") {
    ensureDelegationRenders();
    cursorAgentReflectPreview();
    cursorAgentReflectApply();
    syncCursor("pull");
  } else if (command === "push-cursor") {
    runPersonalRulesSync("export-mcp");
    syncCursor("push");
    ensureDelegationRenders();
    cursorAgentReflectPreview();
    cursorAgentReflectApply();
    stageAndPush() || log("no local changes to push");
  } else if (command === "sync-cursor") {
    runPersonalRulesSync("sync");
    syncCursor("sync");
    ensureDelegationRenders();
    cursorAgentReflectPreview();
    cursorAgentReflectApply();
    copyTree(join(REPO_DIR, "cursor", "skills"), join(CURSOR_TARGET, "skills"));
    stageAndPush() || log("synced; nothing new to push");
  } else if (command === "pull-opencode") {
    syncOpencode("pull");
  } else if (command === "push-opencode") {
    syncOpencode("push");
    ensureDelegationRenders();
    stageAndPush() || log("no local changes to push");
  } else if (command === "sync-opencode") {
    syncOpencode("sync");
    ensureDelegationRenders();
    stageAndPush() || log("synced; nothing new to push");
  } else if (command === "pull-grok") {
    ensureDelegationRenders();
    syncGrok("pull");
  } else if (command === "push-grok") {
    syncGrok("push");
    ensureDelegationRenders();
    stageAndPush() || log("no local changes to push");
  } else if (command === "sync-grok") {
    syncGrok("sync");
    ensureDelegationRenders();
    stageAndPush() || log("synced; nothing new to push");
  } else if (command === "pull-muse") {
    ensureDelegationRenders();
    syncMuse("pull");
  } else if (command === "push-muse") {
    syncMuse("push");
    ensureDelegationRenders();
    stageAndPush() || log("no local changes to push");
  } else if (command === "sync-muse") {
    syncMuse("sync");
    ensureDelegationRenders();
    stageAndPush() || log("synced; nothing new to push");
  } else if (command === "pull-all") {
    syncClaude("pull");
    syncCodex("pull");
    syncOpencode("pull");
    ensureDelegationRenders();
    cursorAgentReflectPreview();
    cursorAgentReflectApply();
    syncCursor("pull");
    syncGrok("pull");
    syncMuse("pull");
    installAmpStyleReminder();
  } else if (command === "sync-all") {
    syncClaude("sync");
    syncCodex("sync");
    agentReflectPreview();
    agentReflectApply();
    syncOpencode("sync");
    ensureDelegationRenders();
    copyTree(join(REPO_DIR, "codex", "skills"), join(CODEX_TARGET, "skills"));
    runPersonalRulesSync("sync");
    syncCursor("sync");
    syncGrok("sync");
    syncMuse("sync");
    cursorAgentReflectPreview();
    cursorAgentReflectApply();
    copyTree(join(REPO_DIR, "cursor", "skills"), join(CURSOR_TARGET, "skills"));
    installAmpStyleReminder();
    stageAndPush() || log("synced; nothing new to push");
  } else if (command === "reflect-claude-memory-preview" || command === "reflect-memory-preview") runMemoryReflect("preview");
  else if (command === "reflect-claude-memory" || command === "reflect-memory") {
    runMemoryReflect("apply");
    syncClaude("pull");
    stageAndPush() || log("memory reflection made no changes to push");
  } else if (command === "reflect-codex-memory-preview") runCodexMemoryReflect("preview");
  else if (command === "reflect-codex-memory") {
    runCodexMemoryReflect("apply");
    syncCodex("pull");
    stageAndPush() || log("codex memory reflection made no changes to push");
  } else if (command === "reflect-cursor-memory-preview") runCursorMemoryReflect("preview");
  else if (command === "reflect-cursor-memory") {
    runCursorMemoryReflect("apply");
    syncClaude("pull");
    stageAndPush() || log("cursor memory reflection made no changes to push");
  } else if (command === "export-cursor-personal-rules") {
    runPersonalRulesSync("export-mcp");
    stageAndPush() || log("cursor personal rules export made no changes to push");
  } else if (command === "apply-cursor-personal-rules") runPersonalRulesSync("apply-mcp");
  else if (command === "sync-cursor-personal-rules") {
    runPersonalRulesSync("sync");
    stageAndPush() || log("cursor personal rules sync made no changes to push");
  } else if (command === "generate-cursor-rules-preview") {
    cursorRuleReflectPreview();
  } else if (command === "generate-cursor-rules") {
    ensureDelegationRenders();
    syncCursor("pull");
    stageAndPush() || log("cursor rule generation made no changes to push");
  } else if (command === "generate-cursor-agents-preview" || command === "reflect-cursor-agents-preview") {
    cursorAgentReflectPreview();
  } else if (command === "generate-cursor-agents" || command === "reflect-cursor-agents") {
    cursorAgentReflectPreview();
    cursorAgentReflectApply();
    syncCursor("pull");
    stageAndPush() || log("cursor agent generation made no changes to push");
  } else if (command === "generate-codex-agents-preview" || command === "reflect-agents-preview") {
    agentReflectPreview();
  } else if (command === "generate-codex-agents" || command === "reflect-agents") {
    agentReflectPreview();
    agentReflectApply();
    ensureDelegationRenders();
    syncCodex("pull");
    stageAndPush() || log("agent generation made no changes to push");
  } else if (command === "generate-codex-agents-md-preview") codexAgentsMdReflectPreview();
  else if (command === "generate-codex-agents-md") {
    ensureDelegationRenders();
    syncCodex("pull");
    stageAndPush() || log("codex agents-md generation made no changes to push");
  } else if (command === "generate-opencode-agents-preview") {
    opencodeAgentReflectPreview();
  } else if (command === "generate-opencode-agents") {
    opencodeAgentReflectPreview();
    opencodeAgentReflectApply();
    ensureDelegationRenders();
    syncOpencode("pull");
    stageAndPush() || log("opencode agent generation made no changes to push");
  } else if (command === "generate-opencode-agents-md-preview") opencodeAgentsMdReflectPreview();
  else if (command === "generate-opencode-agents-md") {
    ensureDelegationRenders();
    syncOpencode("pull");
    stageAndPush() || log("opencode agents-md generation made no changes to push");
  } else if (command === "generate-delegation") {
    stageAndPush() || log("delegation render made no changes to push");
  } else {
    console.error(`unknown command: ${args.command}`);
    process.exit(2);
  }
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
