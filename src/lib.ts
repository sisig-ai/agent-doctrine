import { createHash, randomBytes } from "crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import { homedir, hostname } from "os";
import { spawnSync } from "child_process";

export const BEGIN_MARK = "LOCAL-ONLY:BEGIN";
export const END_MARK = "LOCAL-ONLY:END";
export const REPO_URL = process.env.CLAUDE_MD_REPO ?? "https://github.com/sisig-ai/agent-doctrine.git";
export const REPO_DIR = resolve(process.env.CLAUDE_MD_DIR ?? join(homedir(), ".claude", ".claude-md-repo"));
export const CLAUDE_TARGET = resolve(process.env.CLAUDE_MD_TARGET ?? join(homedir(), ".claude"));
export const CODEX_TARGET = resolve(process.env.CODEX_MD_TARGET ?? join(homedir(), ".codex"));
export const CURSOR_TARGET = resolve(process.env.CURSOR_MD_TARGET ?? join(homedir(), ".cursor"));
export const OPENCODE_TARGET = resolve(process.env.OPENCODE_MD_TARGET ?? join(homedir(), ".config", "opencode"));
export const GROK_TARGET = resolve(process.env.GROK_MD_TARGET ?? join(homedir(), ".grok"));
export const MUSE_TARGET = resolve(process.env.MUSE_MD_TARGET ?? join(homedir(), ".config", "muse"));
export const AMP_TARGET = resolve(process.env.AMP_MD_TARGET ?? join(homedir(), ".config", "amp"));

export const SHARED_FILES = [
  "TASTE.md",
  "TENETS.md",
  "HANDOFFS.md",
  "style-reminder.md",
  "agents/simplifier.md",
  "agents/principal-engineer.md",
  "agents/ai-engineer.md",
  "agents/adv-review.md",
  "agents/scout.md",
];

export const REPO_ONLY_PATHS = [
  ".gitignore",
  "AMP.md",
  "README.md",
  "hosts",
  "sync.sh",
  "SETUP.md",
  "scripts",
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "tsconfig.json",
  "src/cli.ts",
  "src/host-hooks.ts",
  "src/host-sync.ts",
  "src/snapshot.ts",
  "src/lib.ts",
  "src/machine-local.ts",
  "src/project-memory.ts",
  "tests",
  "src/generators.ts",
  "src/memory-reflect.ts",
  "src/personal-rules.ts",
  "src/delegation.ts",
  "delegation.toml",
  "codex",
  "cursor",
  "opencode",
  "grok",
  "muse",
  "amp",
  "claude",
  "skills",
];

export function log(message: string): void {
  console.error(`[doctrine-sync] ${message}`);
}

export function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

export function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function atomicWrite(path: string, data: Buffer | string, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(8).toString("hex")}`);
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  const fd = openSync(temp, "w");
  try {
    writeSync(fd, buf);
    fsyncSync(fd);
    chmodSync(temp, mode);
    renameSync(temp, path);
  } finally {
    closeSync(fd);
    try {
      unlinkSync(temp);
    } catch {
      /* temp moved or absent */
    }
  }
}

export function run(args: string[], opts?: { cwd?: string; quiet?: boolean }): void {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: opts?.cwd,
    stdio: opts?.quiet ? "ignore" : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`command failed: ${args.join(" ")}`);
  }
}

export function capture(args: string[], cwd?: string): string {
  const result = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `command failed: ${args.join(" ")}`);
  }
  return result.stdout ?? "";
}

export function git(...args: string[]): void {
  run(["git", "-C", REPO_DIR, ...args]);
}

export function gitOut(...args: string[]): string {
  return capture(["git", "-C", REPO_DIR, ...args]);
}

export function ensureRepo(): void {
  if (!existsSync(join(REPO_DIR, ".git"))) {
    log(`cloning ${REPO_URL} -> ${REPO_DIR}`);
    mkdirSync(dirname(REPO_DIR), { recursive: true });
    run(["git", "clone", REPO_URL, REPO_DIR]);
  }
}

export function remotePull(): boolean {
  const before = gitOut("rev-parse", "HEAD").trim();
  git("fetch", "--quiet", "origin", "main");
  git("rebase", "--autostash", "origin/main");
  const after = gitOut("rev-parse", "HEAD").trim();
  return before !== after;
}

export function legacyCodexLocalBlock(text: string): string {
  if (text.includes(BEGIN_MARK)) return "";
  if (!text.startsWith("HARD RULE - PHIPA")) return "";
  const cutPoints = ["# Codex Global Instructions", "IMPORTANT - Before proceeding"]
    .map((marker) => text.indexOf(marker))
    .filter((idx) => idx > 0);
  if (!cutPoints.length) return "";
  const body = text.slice(0, Math.min(...cutPoints)).trim();
  if (!body) return "";
  return `<!-- ${BEGIN_MARK} - machine-specific; stripped before sync, never pushed. -->\n\n${body}\n\n<!-- ${END_MARK} -->\n`;
}

export function stripLocalBlock(text: string, opts?: { allowLegacyCodex?: boolean }): string {
  const legacy = opts?.allowLegacyCodex ? legacyCodexLocalBlock(text) : "";
  if (legacy) {
    if (text.includes("IMPORTANT - Before proceeding")) {
      return text.slice(text.indexOf("IMPORTANT - Before proceeding")).replace(/^\n+/, "");
    }
    return text;
  }
  const lines = text.split(/(?<=\n)/);
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.includes(BEGIN_MARK)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (line.includes(END_MARK)) skipping = false;
      continue;
    }
    out.push(line);
  }
  return out.join("").replace(/^\n+/, "");
}

export function extractLocalBlock(text: string, opts?: { allowLegacyCodex?: boolean }): string {
  const legacy = opts?.allowLegacyCodex ? legacyCodexLocalBlock(text) : "";
  if (legacy) return legacy;
  const lines = text.split(/(?<=\n)/);
  const out: string[] = [];
  let copying = false;
  for (const line of lines) {
    if (line.includes(BEGIN_MARK)) copying = true;
    if (copying) {
      out.push(line);
      if (line.includes(END_MARK)) break;
    }
  }
  return out.join("");
}

export function composeWithLocalBlock(targetFile: string, repoBodyFile: string, opts?: { allowLegacyCodex?: boolean }): void {
  const block = extractLocalBlock(readText(targetFile), opts);
  const body = readText(repoBodyFile);
  writeText(targetFile, block ? `${block}\n${body}` : body);
}

export function copyFile(src: string, dst: string): void {
  if (!existsSync(src)) return;
  mkdirSync(dirname(dst), { recursive: true });
  const sourceMode = statSync(src).mode & 0o7777;
  if (existsSync(dst)) chmodSync(dst, (statSync(dst).mode & 0o7777) | 0o200);
  copyFileSync(src, dst);
  chmodSync(dst, sourceMode | 0o200);
}

export function copyTree(src: string, dst: string): void {
  if (!existsSync(src)) return;
  mkdirSync(dst, { recursive: true });
  for (const path of walkFiles(src)) {
    const rel = relative(src, path);
    if (rel.split("/").some((part) => part.startsWith("._") || part === "node_modules")) continue;
    if (statSync(path).isFile()) copyFile(path, join(dst, rel));
  }
}

export function copySharedSkills(target: string): void {
  const src = join(REPO_DIR, "skills");
  if (!existsSync(src)) throw new Error(`shared skills dir is missing: ${src}`);
  copyTree(src, join(target, "skills"));
}

export function walkFiles(root: string, opts?: { mdOnly?: boolean; rejectSymlinks?: boolean }): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      if (opts?.rejectSymlinks) throw new Error(`symlink rejected: ${path}`);
      continue;
    }
    if (entry.isDirectory()) out.push(...walkFiles(path, opts));
    else if (entry.isFile() && (!opts?.mdOnly || path.endsWith(".md"))) out.push(path);
  }
  return out;
}

export function fileDifferent(a: string, b: string): boolean {
  if (!existsSync(a) || !existsSync(b)) return existsSync(a) !== existsSync(b);
  return !readFileSync(a).equals(readFileSync(b));
}

export function newer(a: string, b: string): boolean {
  return statSync(a).mtimeMs > statSync(b).mtimeMs;
}

export function unifiedDiff(current: string, desired: string, fromfile: string, tofile: string): string {
  const a = current.split("\n");
  const b = desired.split("\n");
  const chunks: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    const startI = i;
    const startJ = j;
    while (i < a.length && (j >= b.length || a[i] !== b[j])) i++;
    while (j < b.length && (i >= a.length || a[i] !== b[j])) j++;
    const oldLines = a.slice(startI, i);
    const newLines = b.slice(startJ, j);
    if (!oldLines.length && !newLines.length) break;
    chunks.push(`@@ -${startI + 1},${oldLines.length} +${startJ + 1},${newLines.length} @@\n`);
    for (const line of oldLines) chunks.push(`-${line}\n`);
    for (const line of newLines) chunks.push(`+${line}\n`);
  }
  if (!chunks.length) return "";
  return `--- ${fromfile}\n+++ ${tofile}\n${chunks.join("")}`;
}

export function stageAndPushPaths(ensureDelegation: () => void): boolean {
  ensureDelegation();
  const paths = [
    "CLAUDE.md",
    ...SHARED_FILES,
    ...REPO_ONLY_PATHS,
    "cursor/personal-rules/manifest.json",
    "cursor/personal-rules/rules",
  ];
  const status = gitOut("status", "--porcelain", "--", ...paths);
  if (!status.trim()) return false;
  const existing = paths.filter((p) => existsSync(join(REPO_DIR, p)));
  git("add", "--", ...existing);
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  git("commit", "-m", `Sync doctrine ${stamp}`, "--quiet");
  git("push", "--quiet");
  log("pushed local -> remote");
  return true;
}

export function installWrappers(
  dest: string = join(homedir(), ".local", "bin"),
  defaultSource = "$HOME/.claude/.claude-md-repo",
): void {
  mkdirSync(dest, { recursive: true });
  const source = defaultSource.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const sourceEnv = defaultSource === "$HOME/.claude/.claude-md-repo" ? "" : "export CLAUDE_MD_SNAPSHOT=1\n";
  const wrappers: Record<string, string> = {
    "claude-md-sync": `#!/usr/bin/env bash
set -euo pipefail
repo="\${CLAUDE_MD_DIR:-${source}}"
${sourceEnv}export CLAUDE_MD_DIR="$repo"
exec "$repo/sync.sh" "$@"
`,
    "codex-md-sync": `#!/usr/bin/env bash
set -euo pipefail
repo="\${CLAUDE_MD_DIR:-${source}}"
${sourceEnv}export CLAUDE_MD_DIR="$repo"
cmd="\${1:-sync-codex}"
if [[ "$cmd" == "sync" ]]; then cmd="sync-codex"; shift || true
elif [[ "$cmd" == "pull" ]]; then cmd="pull-codex"; shift || true
elif [[ "$cmd" == "push" ]]; then cmd="push-codex"; shift || true
elif [[ "$cmd" == "status" ]]; then shift || true
else cmd="sync-codex"; fi
exec "$repo/sync.sh" "$cmd" "$@"
`,
    "doctrine-sync": `#!/usr/bin/env bash
set -euo pipefail
repo="\${CLAUDE_MD_DIR:-${source}}"
${sourceEnv}export CLAUDE_MD_DIR="$repo"
cmd="\${1:-sync-all}"
if [[ "$cmd" == "sync" ]]; then cmd="sync-all"; shift || true
elif [[ "$cmd" == "pull" ]]; then cmd="pull-all"; shift || true
elif [[ "$cmd" == "status" ]]; then shift || true
elif [[ "$cmd" == project-memory-* || "$cmd" == "project-memory" ]]; then shift || true
else cmd="sync-all"; fi
exec "$repo/sync.sh" "$cmd" "$@"
`,
    "cursor-md-sync": `#!/usr/bin/env bash
set -euo pipefail
repo="\${CLAUDE_MD_DIR:-${source}}"
${sourceEnv}export CLAUDE_MD_DIR="$repo"
cmd="\${1:-sync-cursor}"
if [[ "$cmd" == "sync" ]]; then cmd="sync-cursor"; shift || true
elif [[ "$cmd" == "pull" ]]; then cmd="pull-cursor"; shift || true
elif [[ "$cmd" == "push" ]]; then cmd="push-cursor"; shift || true
elif [[ "$cmd" == "status" ]]; then shift || true
else cmd="sync-cursor"; fi
exec "$repo/sync.sh" "$cmd" "$@"
`,
    "opencode-md-sync": `#!/usr/bin/env bash
set -euo pipefail
repo="\${CLAUDE_MD_DIR:-${source}}"
${sourceEnv}export CLAUDE_MD_DIR="$repo"
cmd="\${1:-sync-opencode}"
if [[ "$cmd" == "sync" ]]; then cmd="sync-opencode"; shift || true
elif [[ "$cmd" == "pull" ]]; then cmd="pull-opencode"; shift || true
elif [[ "$cmd" == "push" ]]; then cmd="push-opencode"; shift || true
elif [[ "$cmd" == "status" ]]; then shift || true
else cmd="sync-opencode"; fi
exec "$repo/sync.sh" "$cmd" "$@"
`,
  };
  for (const [name, text] of Object.entries(wrappers)) {
    const path = join(dest, name);
    writeFileSync(path, text);
    chmodSync(path, 0o755);
    log(`installed -> ${path}`);
  }
}

export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  if (!text.startsWith("---\n")) return { meta: {}, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { meta: {}, body: text };
  const front = text.slice(4, end).split("\n");
  const body = text.slice(end + "\n---\n".length);
  const meta: Record<string, string> = {};
  let idx = 0;
  while (idx < front.length) {
    const line = front[idx];
    if (!line.trim() || line.startsWith(" ")) {
      idx++;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      idx++;
      continue;
    }
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (value === ">-" || value === "|-") {
      const folded: string[] = [];
      idx++;
      while (idx < front.length && (front[idx].startsWith(" ") || !front[idx].trim())) {
        folded.push(front[idx].trim());
        idx++;
      }
      meta[key] = folded.filter(Boolean).join(" ").trim();
      continue;
    }
    meta[key] = value.replace(/^["']|["']$/g, "");
    idx++;
  }
  return { meta, body };
}

export function yamlBlock(key: string, value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim() || "Shared doctrine agent synced from the claude-md repo.";
  const wrapped = wrap(cleaned, 92).map((line) => `  ${line}`).join("\n");
  return `${key}: >-\n${wrapped}`;
}

export function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function titleize(name: string): string {
  return name
    .split("-")
    .map((part) => (part === "ai" ? "AI" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
