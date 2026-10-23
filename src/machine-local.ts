import { spawnSync } from "child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import {
  CLAUDE_TARGET,
  CODEX_TARGET,
  CURSOR_TARGET,
  GROK_TARGET,
  MUSE_TARGET,
  OPENCODE_TARGET,
  REPO_DIR,
  isSymlink,
  log,
  sha256,
} from "./lib.ts";

export class MachineLocalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MachineLocalError";
  }
}

export type LocalMirror = { label: string; path: string };

export type MachineLocalPaths = {
  cache: string;
  canonical: string;
  mirrors: LocalMirror[];
};

export function defaultMachineLocalPaths(): MachineLocalPaths {
  return {
    cache: resolve(
      process.env.CLAUDE_MD_LOCAL_CACHE ??
        (process.env.CLAUDE_MD_SNAPSHOT
          ? join(CLAUDE_TARGET, "..", ".local", "state", "doctrine-sync", "LOCAL.md")
          : join(REPO_DIR, ".local", "LOCAL.md")),
    ),
    canonical: resolve(CLAUDE_TARGET, "LOCAL.md"),
    mirrors: [
      { label: "codex", path: resolve(CODEX_TARGET, "LOCAL.md") },
      { label: "cursor", path: resolve(CURSOR_TARGET, "LOCAL.md") },
      { label: "opencode", path: resolve(OPENCODE_TARGET, "LOCAL.md") },
      { label: "grok", path: resolve(GROK_TARGET, "LOCAL.md") },
      { label: "muse", path: resolve(MUSE_TARGET, "LOCAL.md") },
    ],
  };
}

function readPresent(path: string): string | null {
  try {
    if (!existsSync(path) && !isSymlink(path)) return null;
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function ensureRealFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (isSymlink(path)) unlinkSync(path);
  if (existsSync(path) && readFileSync(path, "utf-8") === content) return;
  writeFileSync(path, content);
}

function pointsAt(linkPath: string, targetPath: string): boolean {
  if (!isSymlink(linkPath)) return false;
  const current = readlinkSync(linkPath);
  return resolve(dirname(linkPath), current) === resolve(targetPath);
}

function ensureSymlink(path: string, target: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (pointsAt(path, target)) return;
  if (isSymlink(path) || existsSync(path)) unlinkSync(path);
  symlinkSync(target, path);
}

export type LocalVariant = { label: string; path: string; content: string };
export type LocalArbiter = (variants: LocalVariant[]) => string;

const ARBITER_SCHEMA = JSON.stringify({
  type: "object",
  properties: { merged: { type: "string" } },
  required: ["merged"],
  additionalProperties: false,
});

export function claudeArbiter(variants: LocalVariant[]): string {
  const bin = process.env.CLAUDE_BIN ?? Bun.which("claude");
  if (!bin || !existsSync(bin)) {
    throw new MachineLocalError(
      "LOCAL.md arbitration needs the claude cli (set CLAUDE_BIN or put claude on PATH)",
    );
  }
  const prompt = [
    "these are copies of one machine-local notes file (LOCAL.md) that drifted apart on the same machine.",
    "merge them into one file. keep every fact and instruction from every copy. drop exact duplicates. do not add anything. do not summarize. keep markdown headings and order sensible.",
    "return the full merged file in `merged`.",
    ...variants.map((v) => `\n===== ${v.label} (${v.path}) =====\n${v.content}`),
  ].join("\n");
  const cwd = mkdtempSync(join(tmpdir(), "doctrine-sync-arbiter-"));
  const result = spawnSync(
    bin,
    [
      "-p",
      "--safe-mode",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--model",
      "claude-opus-5",
      "--tools",
      "",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--output-format",
      "json",
      "--json-schema",
      ARBITER_SCHEMA,
    ],
    { cwd, input: prompt, encoding: "utf-8", timeout: 600_000 },
  );
  if (result.error) {
    throw new MachineLocalError(`LOCAL.md arbitration could not run ${bin}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new MachineLocalError(
      `LOCAL.md arbitration failed (${result.signal ?? `exit ${result.status}`}): ${(result.stderr ?? "").trim()}`,
    );
  }
  let envelope: { structured_output?: { merged?: unknown } };
  try {
    envelope = JSON.parse(result.stdout ?? "");
  } catch {
    throw new MachineLocalError(
      `LOCAL.md arbitration returned non-json: ${(result.stdout ?? "").slice(0, 200)}`,
    );
  }
  const merged = envelope.structured_output?.merged;
  if (typeof merged !== "string" || !merged.trim()) {
    throw new MachineLocalError("LOCAL.md arbitration returned no content");
  }
  return merged.endsWith("\n") ? merged : `${merged}\n`;
}

function writeConflictBackups(cachePath: string, variants: LocalVariant[]): string {
  const dir = join(dirname(cachePath), "conflicts");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const v of variants) {
    writeFileSync(join(dir, `${stamp}-${v.label}.md`), v.content);
  }
  return dir;
}

/**
 * Reconcile per-machine LOCAL.md across agent homes on this host.
 *
 * Never crosses machines (not committed). Canonical file is ~/.claude/LOCAL.md;
 * the agent-home mirrors (codex, cursor, opencode, grok, muse) are symlinks to it. A
 * gitignored copy is kept at <repo>/.local/LOCAL.md as a durable cache.
 *
 * Homes that agree overwrite a stale cache. Divergent homes are merged by claude opus 5; a stale cache never blocks a sync.
 */
export function reconcileMachineLocal(
  paths: MachineLocalPaths = defaultMachineLocalPaths(),
  arbitrate: LocalArbiter = claudeArbiter,
): {
  content: string | null;
  sources: string[];
} {
  const candidates = [
    { label: "repo-cache", path: paths.cache },
    { label: "claude", path: paths.canonical },
    ...paths.mirrors.map(({ label, path }) => ({ label, path })),
  ];

  const present: { label: string; path: string; content: string; hash: string }[] = [];
  for (const candidate of candidates) {
    const content = readPresent(candidate.path);
    if (content === null) continue;
    present.push({ label: candidate.label, path: candidate.path, content, hash: sha256(content) });
  }

  if (present.length === 0) {
    log("machine LOCAL.md: none present");
    return { content: null, sources: [] };
  }

  const homes = present.filter((p) => p.path !== paths.cache);
  const byHash = new Map<string, (typeof homes)[number]>();
  for (const h of homes) {
    if (!byHash.has(h.hash)) byHash.set(h.hash, h);
  }
  const variants = [...byHash.values()];
  let content: string;
  if (variants.length > 1) {
    content = arbitrate(variants);
    const kept = new Set(content.split("\n"));
    for (const v of variants) {
      const lost = v.content.split("\n").find((l) => l.trim() && !kept.has(l));
      if (lost !== undefined) {
        throw new MachineLocalError(`LOCAL.md arbitration dropped a line from ${v.path}: ${lost}`);
      }
    }
    const dir = writeConflictBackups(paths.cache, variants);
    log(`machine LOCAL.md: ${variants.length} home variants merged by arbiter; inputs kept in ${dir}`);
  } else {
    content = (homes[0] ?? present[0])!.content;
  }
  ensureRealFile(paths.canonical, content);
  ensureRealFile(paths.cache, content);
  for (const { path } of paths.mirrors) {
    ensureSymlink(path, paths.canonical);
  }

  // Confirm mirrors resolve and match.
  for (const { path } of paths.mirrors) {
    if (!pointsAt(path, paths.canonical)) {
      throw new MachineLocalError(`failed to link ${path} -> ${paths.canonical}`);
    }
    if (lstatSync(paths.canonical).isSymbolicLink()) {
      throw new MachineLocalError(`canonical LOCAL.md must be a real file: ${paths.canonical}`);
    }
  }

  log(`machine LOCAL.md: reconciled (${paths.canonical}; mirrors -> symlink)`);
  return { content, sources: present.map((p) => p.path) };
}

export function machineLocalStatus(paths: MachineLocalPaths = defaultMachineLocalPaths()): string {
  const rows: string[] = [];
  const entries = [
    ["claude", paths.canonical],
    ...paths.mirrors.map(({ label, path }) => [label, path] as const),
    ["repo-cache", paths.cache],
  ];
  for (const [label, path] of entries) {
    if (isSymlink(path)) {
      let target = "?";
      try {
        target = readlinkSync(path);
      } catch {
        /* ignore */
      }
      rows.push(`${label}: symlink -> ${target}`);
    } else if (existsSync(path)) {
      rows.push(`${label}: present (${sha256(readFileSync(path, "utf-8")).slice(0, 12)})`);
    } else {
      rows.push(`${label}: missing`);
    }
  }
  return rows.join("\n");
}
