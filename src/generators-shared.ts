import { appendFileSync, existsSync } from "fs";
import { join, relative } from "path";
import { REPO_DIR, readText, unifiedDiff } from "./lib.ts";
import { loadDelegation, renderDelegation } from "./delegation.ts";

export type GeneratorStatus = Record<string, string> & { status: string };

export function log(tag: string, message: string): void {
  console.error(`[${tag}] ${message}`);
}

export const PATH_REWRITES = {
  codex: [
    ["~/.claude/TENETS.md", "~/.codex/TENETS.md"],
    ["~/.claude/TASTE.md", "~/.codex/TASTE.md"],
    ["~/.claude/LOCAL.md", "~/.codex/LOCAL.md"],
    ["~/.claude/CLAUDE.md", "~/.codex/AGENTS.md"],
    ["~/.claude/HANDOFFS.md", "~/.codex/HANDOFFS.md"],
  ],
  cursor: [
    ["~/.claude/TENETS.md", "~/.cursor/TENETS.md"],
    ["~/.claude/TASTE.md", "~/.cursor/TASTE.md"],
    ["~/.claude/CLAUDE.md", "~/.cursor/rules/doctrine.mdc"],
    ["~/.claude/LOCAL.md", "~/.cursor/LOCAL.md"],
    ["~/.claude/HANDOFFS.md", "~/.cursor/HANDOFFS.md"],
  ],
  cursorAgent: [
    ["~/.claude/TENETS.md", "~/.cursor/TENETS.md"],
    ["~/.claude/TASTE.md", "~/.cursor/TASTE.md"],
    ["~/.claude/CLAUDE.md", "~/.cursor/rules/doctrine.mdc"],
    ["~/.claude/HANDOFFS.md", "~/.cursor/HANDOFFS.md"],
  ],
  opencode: [
    ["~/.claude/CLAUDE.md", "~/.config/opencode/AGENTS.md"],
    ["~/.claude/TENETS.md", "~/.config/opencode/TENETS.md"],
    ["~/.claude/TASTE.md", "~/.config/opencode/TASTE.md"],
    ["~/.claude/LOCAL.md", "~/.config/opencode/LOCAL.md"],
    ["~/.claude/HANDOFFS.md", "~/.config/opencode/HANDOFFS.md"],
    ["~/.claude", "~/.config/opencode"],
  ],
  grok: [
    ["~/.claude/HANDOFFS.md", "~/.grok/HANDOFFS.md"],
    ["~/.claude/TENETS.md", "~/.grok/TENETS.md"],
    ["~/.claude/CLAUDE.md", "~/.grok/rules/doctrine.md"],
    ["~/.claude/TASTE.md", "~/.grok/TASTE.md"],
    ["~/.claude/LOCAL.md", "~/.grok/LOCAL.md"],
  ],
  muse: [
    ["~/.claude/HANDOFFS.md", "~/.config/muse/HANDOFFS.md"],
    ["~/.claude/TENETS.md", "~/.config/muse/TENETS.md"],
    ["~/.claude/CLAUDE.md", "~/.config/muse/AGENTS.md"],
    ["~/.claude/TASTE.md", "~/.config/muse/TASTE.md"],
    ["~/.claude/LOCAL.md", "~/.config/muse/LOCAL.md"],
    ["~/.claude", "~/.config/muse"],
  ],
} as const;

export function rewritePaths(body: string, variant: keyof typeof PATH_REWRITES, trimTrailing = true): string {
  let out = body;
  for (const [from, to] of PATH_REWRITES[variant]) out = out.replaceAll(from, to);
  return trimTrailing ? out.replace(/\s+$/, "\n") : out;
}

export function composeHostDoctrine(target: "claude" | "codex" | "cursor" | "opencode" | "grok" | "muse"): string {
  const base = readText(join(REPO_DIR, "CLAUDE.md"));
  const overlayPath = join(REPO_DIR, "hosts", `${target}.md`);
  const overlay = readText(overlayPath);
  if (!overlay.trim()) throw new Error(`missing host overlay: hosts/${target}.md`);
  const data = loadDelegation(join(REPO_DIR, "delegation.toml"));
  const rendered = renderDelegation(base, target, data).trimEnd();
  // hosts/grok.md names ~/.claude/CLAUDE.md as the compat file that loads later. rewrite the shared body only.
  const shared = target === "grok" ? rewritePaths(rendered, "grok").trimEnd() : target === "muse" ? rewritePaths(rendered, "muse").trimEnd() : rendered;
  return `${shared}\n\n${overlay.trim()}\n`;
}

export function generatedClaudeDoctrine(): string {
  return composeHostDoctrine("claude");
}

export function writeLedger(ledgerFile: string, entry: Record<string, unknown>): void {
  appendFileSync(ledgerFile, `${JSON.stringify(entry, Object.keys(entry).sort())}\n`);
}

export const AGENTS_DIR = process.env.CLAUDE_MD_AGENTS_DIR ?? join(REPO_DIR, "agents");

export function buildMultiDiff(items: [string, string, Record<string, string>][], obsoleteFinder: () => string[]): [string, GeneratorStatus[]] {
  const chunks: string[] = [];
  const statuses: GeneratorStatus[] = [];
  const desiredTargets = new Set(items.map(([t]) => t));
  for (const [target, desired, meta] of items) {
    const current = readText(target);
    const status = current === desired ? "unchanged" : existsSync(target) ? "update" : "create";
    statuses.push({ ...meta, status });
    if (current !== desired) {
      const rel = relative(REPO_DIR, target).replace(/\\/g, "/");
      chunks.push(unifiedDiff(current.replace(/\n$/, ""), desired.replace(/\n$/, ""), `a/${rel}`, `b/${rel}`));
    }
  }
  for (const obsolete of obsoleteFinder()) {
    if (desiredTargets.has(obsolete)) continue;
    const current = readText(obsolete);
    const rel = relative(REPO_DIR, obsolete).replace(/\\/g, "/");
    statuses.push({ source: "", target: rel, name: obsolete.split("/").slice(-2, -1)[0] ?? "", status: "delete" });
    chunks.push(unifiedDiff(current.replace(/\n$/, ""), "", `a/${rel}`, `b/${rel}`));
  }
  return [chunks.join(""), statuses];
}
