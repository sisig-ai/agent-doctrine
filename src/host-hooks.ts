import { existsSync } from "fs";
import { join } from "path";
import {
  AMP_TARGET,
  CLAUDE_TARGET,
  CODEX_TARGET,
  CURSOR_TARGET,
  OPENCODE_TARGET,
  REPO_DIR,
  copyFile,
  copyTree,
  log,
  readText,
  writeText,
} from "./lib.ts";

function shellQuote(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

export function ensureCommandHook(settingsPath: string, command: string, onAdd: string): void {
  const settings = existsSync(settingsPath) ? JSON.parse(readText(settingsPath)) : {};
  const hooks = (settings.hooks ??= {});
  const groups = (hooks.UserPromptSubmit ??= []);
  if (groups.some((g: { hooks?: { command?: string }[] }) => g.hooks?.some((h) => h.command === command))) return;
  groups.push({ hooks: [{ type: "command", command }] });
  writeText(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  log(onAdd);
}

export function ensureClaudeStyleHook(claudeTarget: string = CLAUDE_TARGET): void {
  const reminderPath = join(claudeTarget, "style-reminder.md");
  ensureCommandHook(
    join(claudeTarget, "settings.json"),
    `cat ${shellQuote(reminderPath)}`,
    "claude settings.json: added UserPromptSubmit style reminder hook",
  );
}

export function ensureCodexStyleHook(codexTarget: string = CODEX_TARGET): void {
  const reminderPath = join(codexTarget, "style-reminder.md");
  ensureCommandHook(
    join(codexTarget, "hooks.json"),
    `cat ${shellQuote(reminderPath)}`,
    "codex hooks.json: added UserPromptSubmit style reminder hook; open /hooks in codex once to trust it",
  );
}

const CURSOR_HOOK_EVENTS = ["sessionStart", "postToolUse", "postToolUseFailure"];

export function ensureCursorStyleHooks(cursorTarget: string = CURSOR_TARGET): void {
  const reminderPath = join(cursorTarget, "style-reminder.md");
  const text = readText(reminderPath).trim();
  if (!text) throw new Error(`cursor style-reminder: ${reminderPath} is missing or empty`);
  const outputPath = join(cursorTarget, "style-reminder.json");
  writeText(outputPath, `${JSON.stringify({ additional_context: text })}\n`);

  const hooksPath = join(cursorTarget, "hooks.json");
  const file = existsSync(hooksPath) ? JSON.parse(readText(hooksPath)) : { version: 1, hooks: {} };
  if (typeof file !== "object" || file === null || Array.isArray(file)) {
    throw new Error(`cursor hooks.json: not an object: ${hooksPath}`);
  }
  if (file.version !== undefined && file.version !== 1) {
    throw new Error(`cursor hooks.json: unsupported version ${file.version}`);
  }
  let changed = file.version !== 1;
  file.version = 1;
  const hooks = (file.hooks ??= {});
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) {
    throw new Error(`cursor hooks.json: malformed hooks object: ${hooksPath}`);
  }
  const command = `cat ${shellQuote(outputPath)}`;
  for (const event of CURSOR_HOOK_EVENTS) {
    const groups = (hooks[event] ??= []);
    if (!Array.isArray(groups)) throw new Error(`cursor hooks.json: malformed ${event} list: ${hooksPath}`);
    if (groups.some((g: { command?: string }) => g?.command === command)) continue;
    groups.push({ command });
    changed = true;
  }
  if (!changed) return;
  writeText(hooksPath, `${JSON.stringify(file, null, 2)}\n`);
  log("cursor hooks.json: added sessionStart, postToolUse, postToolUseFailure style reminder hooks");
}

export function installAmpStyleReminder(target: string = AMP_TARGET): void {
  copyFile(join(REPO_DIR, "style-reminder.md"), join(target, "style-reminder.md"));
  copyTree(join(REPO_DIR, "amp", "plugins", "style-reminder"), join(target, "plugins", "style-reminder"));
}

// --- handoff compression integration -----------------------------------

export const HANDOFF_PLUGIN_DIR = "handoff";
const LOCAL_HANDOFF_MARKER = "does not require porch";

/**
 * Deploy the self-contained handoff core next to a host target. The core
 * imports only node builtins, so one copy per target is enough.
 */
export function deployHandoffCore(target: string): void {
  copyFile(join(REPO_DIR, "scripts", "handoff.ts"), join(target, "handoff.ts"));
}

/**
 * Activate the opencode delegation guard. This is a local-only mode: it refuses
 * unless the target's LOCAL.md declares the machine-local handoff override, so a
 * porch-only host never receives an unusable mandatory pointer. Ordinary sync
 * deploys the core but leaves the guard inactive, and it never removes a guard an
 * earlier local install put in place.
 */
export function installHandoffLocal(
  opencodeTarget: string = OPENCODE_TARGET,
  localPath: string = join(opencodeTarget, "LOCAL.md"),
): void {
  const local = existsSync(localPath) ? readText(localPath) : "";
  if (!local.includes(LOCAL_HANDOFF_MARKER)) {
    throw new Error(
      `install-handoff-local refuses: ${localPath} does not declare the local handoff override ` +
        `(expected "${LOCAL_HANDOFF_MARKER}"); ordinary sync deploys the core but not the guard`,
    );
  }
  deployHandoffCore(opencodeTarget);
  copyTree(join(REPO_DIR, "opencode", "plugins", HANDOFF_PLUGIN_DIR), join(opencodeTarget, "plugins", HANDOFF_PLUGIN_DIR));
  log("handoff: installed local opencode delegation guard");
}

export interface HandoffCapability {
  host: string;
  enforcement: "installed" | "compressor-only" | "unsupported";
  detail: string;
}

/**
 * Describe, from installed artifacts, what each host can do. File presence
 * shows installation, not live activation: opencode loads the plugin at server
 * start, and the local-only core cannot enforce on a remote machine.
 */
export function handoffCapabilities(
  roots: { claude?: string; opencode?: string } = {},
): HandoffCapability[] {
  const opencodeRoot = roots.opencode ?? OPENCODE_TARGET;
  const claudeRoot = roots.claude ?? CLAUDE_TARGET;
  const opencodePlugin = join(opencodeRoot, "plugins", "handoff", "index.ts");
  const opencodeCore = join(opencodeRoot, "handoff.ts");
  const claudeCore = join(claudeRoot, "handoff.ts");
  const opencodeInstalled = existsSync(opencodePlugin) && existsSync(opencodeCore);
  return [
    {
      host: "opencode",
      enforcement: opencodeInstalled ? "installed" : "unsupported",
      detail: opencodeInstalled
        ? "handoff plugin and core are installed at the opencode target; the plugin rejects a subagent delegation without exactly one valid pointer. activation needs a server reload. receipts are local to this machine."
        : "handoff plugin or core is not installed under the opencode target",
    },
    {
      host: "claude",
      enforcement: existsSync(claudeCore) ? "compressor-only" : "unsupported",
      detail: existsSync(claudeCore)
        ? "isolated claude compressor adapter is installed. delegation interception is unsupported: the only blocking claude hook is PreToolUse, forbidden by shared doctrine."
        : "handoff core is not installed under the claude target",
    },
    {
      host: "codex",
      enforcement: "unsupported",
      detail: "no verified blocking tool hook; UserPromptSubmit cannot see a subagent tool call",
    },
    {
      host: "cursor",
      enforcement: "unsupported",
      detail: "sessionStart and postToolUse hooks are non-blocking; PreToolUse is forbidden by shared doctrine",
    },
    {
      host: "amp",
      enforcement: "unsupported",
      detail: "no verified blocking tool hook",
    },
  ];
}
