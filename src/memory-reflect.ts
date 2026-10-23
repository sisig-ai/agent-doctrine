import { createHash } from "crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, appendFileSync, statSync } from "fs";
import { homedir, hostname, tmpdir } from "os";
import { basename, join } from "path";
import { spawnSync } from "child_process";
import { REPO_DIR, readText, unifiedDiff, walkFiles, writeText } from "./lib.ts";
import { exportMemoryDir } from "./personal-rules.ts";

function resolveEnv(key: string, fallback: string): string {
  return process.env[key] ? join(process.env[key]!) : fallback;
}

function reflectionPaths() {
  const targetDir = resolveEnv("CLAUDE_MD_TARGET", join(homedir(), ".claude"));
  return {
    memoryDir: resolveEnv("CLAUDE_MEMORY_DIR", join(targetDir, "memory")),
    projectsDir: resolveEnv("CLAUDE_PROJECTS_DIR", join(targetDir, "projects")),
    patchFile: resolveEnv("CLAUDE_MEMORY_PATCH", join(REPO_DIR, ".memory-reflect.patch")),
    rationaleFile: resolveEnv("CLAUDE_MEMORY_RATIONALE", join(REPO_DIR, ".memory-reflect.rationale")),
    statusFile: resolveEnv("CLAUDE_MEMORY_STATUSES", join(REPO_DIR, ".memory-reflect.statuses.json")),
    ledgerFile: resolveEnv("CLAUDE_MEMORY_LEDGER", join(REPO_DIR, "memory-reflect-ledger.jsonl")),
  };
}

interface MemoryRecord {
  path: string;
  sha256: string;
  bytes: number;
  content?: string;
  reason?: string;
}

function log(message: string): void {
  console.error(`[memory-reflect] ${message}`);
}

function die(message: string): never {
  throw new Error(`[memory-reflect] error: ${message}`);
}

function which(candidate: string): string | null {
  if (candidate.includes("/")) {
    return existsSync(candidate) ? candidate : null;
  }
  const result = spawnSync("which", [candidate], { encoding: "utf-8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function resolveClaude(): string {
  if (process.env.CLAUDE_BIN) {
    const candidate = process.env.CLAUDE_BIN;
    if (existsSync(candidate)) return candidate;
    die(`CLAUDE_BIN is not executable: ${candidate}`);
  }
  for (const candidate of ["claude", join(homedir(), ".local/bin/claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"]) {
    const found = which(candidate);
    if (found) return found;
  }
  die("claude not found on PATH or known fallback paths");
}

function requireRepo(): void {
  for (const rel of ["CLAUDE.md", "TASTE.md"]) {
    if (!existsSync(join(REPO_DIR, rel))) die(`missing ${join(REPO_DIR, rel)}`);
  }
}

function includedByPolicy(label: string, rel: string): boolean {
  if (label === "global") return true;
  return label.startsWith("projects/") && rel.split("/").pop()!.startsWith("feedback_");
}

function closedLedgerEntries(ledgerFile: string): Set<string> {
  const closed = new Set<string>();
  if (!existsSync(ledgerFile)) return closed;
  for (const line of readFileSync(ledgerFile, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (["applied", "already_represented", "not_relevant"].includes(entry.status)) {
        closed.add(`${entry.path}\0${entry.sha256}`);
      }
    } catch {
      /* skip */
    }
  }
  return closed;
}

function collectMemory(): Record<string, MemoryRecord[]> {
  const { memoryDir, projectsDir, ledgerFile } = reflectionPaths();
  const roots: [string, string][] = [];
  if (existsSync(memoryDir) && statIsDir(memoryDir)) roots.push(["global", memoryDir]);
  if (existsSync(projectsDir) && statIsDir(projectsDir)) {
    for (const project of readdirSync(projectsDir).sort()) {
      const mem = join(projectsDir, project, "memory");
      if (existsSync(mem) && statIsDir(mem)) roots.push([`projects/${project}`, mem]);
    }
  }
  if (!roots.length) die(`no memory directories found under ${memoryDir} or ${projectsDir}`);
  const closed = closedLedgerEntries(ledgerFile);
  const pending: MemoryRecord[] = [];
  const skipped: MemoryRecord[] = [];
  const ignored: MemoryRecord[] = [];
  for (const [label, root] of roots) {
    for (const path of walkMd(root).sort()) {
      const rel = path.slice(root.length + 1).replace(/\\/g, "/");
      const scoped = `${label}/${rel}`;
      const data = readFileSync(path);
      const sha = createHash("sha256").update(data).digest("hex");
      const base: MemoryRecord = { path: scoped, sha256: sha, bytes: data.length };
      if (!includedByPolicy(label, rel)) {
        ignored.push({ ...base, reason: "project memory is not feedback_*.md" });
      } else if (closed.has(`${scoped}\0${sha}`)) {
        skipped.push(base);
      } else {
        pending.push({ ...base, content: data.toString("utf-8") });
      }
    }
  }
  return { pending, skipped, ignored };
}

function statIsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walkMd(root: string): string[] {
  return walkFiles(root, { mdOnly: true });
}

function schemaJson(): string {
  return JSON.stringify({
    type: "object",
    additionalProperties: false,
    properties: {
      decision: { type: "string", enum: ["NO_CHANGES", "UPDATE"] },
      rationale: { type: "string" },
      claude_md: { type: ["string", "null"] },
      taste_md: { type: ["string", "null"] },
      memory_statuses: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string" },
            status: { type: "string", enum: ["applied", "already_represented", "not_relevant"] },
            rationale: { type: "string" },
          },
          required: ["path", "status", "rationale"],
        },
      },
    },
    required: ["decision", "rationale", "claude_md", "taste_md", "memory_statuses"],
  });
}

function runClaude(prompt: string): Record<string, unknown> {
  const claude = resolveClaude();
  log(`using ${claude}`);
  const result = spawnSync(claude, ["-p", "--no-session-persistence", "--tools=", "--output-format", "json", "--json-schema", schemaJson()], {
    cwd: REPO_DIR,
    input: prompt,
    encoding: "utf-8",
    timeout: 900_000,
  });
  if (result.status !== 0) die(result.stderr || "claude failed");
  const data = JSON.parse(result.stdout!);
  if (!data.structured_output || typeof data.structured_output !== "object") die("missing structured_output in Claude JSON");
  return data.structured_output;
}

function ensureNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function renderPatch(structured: Record<string, unknown>, sourceMeta: Record<string, MemoryRecord[]>, tmp: string): void {
  const { rationaleFile, statusFile, patchFile } = reflectionPaths();
  const claudePath = join(tmp, "CLAUDE.md");
  const tastePath = join(tmp, "TASTE.md");
  writeText(claudePath, readText(join(REPO_DIR, "CLAUDE.md")));
  writeText(tastePath, readText(join(REPO_DIR, "TASTE.md")));
  const sourceByPath = Object.fromEntries(sourceMeta.pending.map((i) => [i.path, i]));
  const records: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const item of structured.memory_statuses as Record<string, string>[]) {
    const path = item.path;
    if (!(path in sourceByPath)) die(`unknown memory_statuses path: ${path}`);
    if (seen.has(path)) die(`duplicate memory_statuses path: ${path}`);
    seen.add(path);
    records.push({ ...sourceByPath[path], status: item.status, rationale: (item.rationale ?? "").trim() });
  }
  const missing = Object.keys(sourceByPath).filter((p) => !seen.has(p));
  if (missing.length) die(`missing memory_statuses paths: ${missing.join(", ")}`);
  const decision = structured.decision;
  if (decision === "NO_CHANGES") {
    if (structured.claude_md !== null || structured.taste_md !== null) die("NO_CHANGES must return null docs");
  } else if (decision === "UPDATE") {
    if (structured.claude_md === null && structured.taste_md === null) die("UPDATE must change at least one doc");
    if (structured.claude_md !== null) writeText(claudePath, ensureNewline(String(structured.claude_md)));
    if (structured.taste_md !== null) writeText(tastePath, ensureNewline(String(structured.taste_md)));
  } else {
    die(`unknown decision: ${decision}`);
  }
  writeText(rationaleFile, `${String(structured.rationale ?? "").trim()}\n`);
  writeText(statusFile, `${JSON.stringify(records, null, 2)}\n`);
  const parts: string[] = [];
  for (const [rel, candidate] of [
    ["CLAUDE.md", claudePath],
    ["TASTE.md", tastePath],
  ] as const) {
    const original = readText(join(REPO_DIR, rel));
    const revised = readText(candidate);
    if (original !== revised) {
      parts.push(unifiedDiff(original.replace(/\n$/, ""), revised.replace(/\n$/, ""), `a/${rel}`, `b/${rel}`));
    }
  }
  writeText(patchFile, parts.length ? parts.join("") : "NO_CHANGES\n");
}

function buildPrompt(bundle: string, sources: string): string {
  return `You are maintaining the user's shared Claude Code doctrine repository.

Goal:
Distill pending machine-local memory notes into durable shared guidance in CLAUDE.md and/or TASTE.md.

Rules:
- Return structured output matching the provided schema.
- Set decision to NO_CHANGES if the pending memories are already represented well enough or are not relevant to shared doctrine.
- If changing a doc, return the complete final markdown for that doc.
- Return null for any doc that should not change.
- Do not copy whole memory notes into the docs.
- Prefer the smallest useful edit.
- Avoid duplicating guidance that is already present.
- Put hard operating contract / role / workflow rules in CLAUDE.md only if they must always be loaded.
- Put user preferences, working style, tooling taste, and observed patterns in TASTE.md.
- Keep wording terse, direct, and consistent with the existing files.
- Preserve existing structure unless a small insertion clearly belongs in an existing section.
- Preserve a trailing newline at end of file.
- For every pending memory path, include exactly one memory_statuses entry.
- Use status "applied" when the memory is reflected by the returned doc changes.
- Use status "already_represented" when current docs already cover it without changes.
- Use status "not_relevant" when it should not become shared doctrine.
- Do not invent memory paths.

Current CLAUDE.md:
\`\`\`markdown
${readText(join(REPO_DIR, "CLAUDE.md"))}
\`\`\`

Current TASTE.md:
\`\`\`markdown
${readText(join(REPO_DIR, "TASTE.md"))}
\`\`\`

Pending memory metadata:
\`\`\`json
${readText(sources)}
\`\`\`

Pending memory notes:
\`\`\`markdown
${readText(bundle)}
\`\`\`
`;
}

function validatePatch(): void {
  const { patchFile } = reflectionPaths();
  const content = readText(patchFile);
  if (content.trim() === "NO_CHANGES") return;
  if (!content.split("\n").some((l) => l.startsWith("--- a/CLAUDE.md") || l.startsWith("--- a/TASTE.md"))) {
    die("generated output was not a diff");
  }
  const result = spawnSync("git", ["-C", REPO_DIR, "apply", "--check", patchFile]);
  if (result.status !== 0) die("patch does not apply");
}

export function memoryReflectPreview(): void {
  requireRepo();
  const { patchFile, rationaleFile, statusFile } = reflectionPaths();
  const collected = collectMemory();
  if (!collected.pending.length) {
    writeText(patchFile, "NO_CHANGES\n");
    writeText(rationaleFile, "No unprocessed memory hashes found.\n");
    writeText(statusFile, "[]\n");
  } else {
    log(`analyzing ${collected.pending.length} pending memory file(s)`);
    const tmp = mkdtempSync(join(tmpdir(), "memory-reflect-"));
    const bundle = join(tmp, "memory.md");
    const sources = join(tmp, "sources.json");
    let bundleText = "";
    for (const item of collected.pending) {
      bundleText += `\n--- MEMORY FILE: ${item.path} ---\nsha256: ${item.sha256}\n\n${item.content ?? ""}`;
      if (!(item.content ?? "").endsWith("\n")) bundleText += "\n";
    }
    writeText(bundle, bundleText);
    const sourceMeta = {
      pending: collected.pending.map((r) => ({
        path: r.path,
        sha256: r.sha256,
        bytes: r.bytes,
        ...(r.reason ? { reason: r.reason } : {}),
      })),
      skipped: collected.skipped.map((r) => ({ path: r.path, sha256: r.sha256, bytes: r.bytes })),
      ignored: collected.ignored.map((r) => ({ path: r.path, sha256: r.sha256, bytes: r.bytes, reason: r.reason })),
    };
    writeText(sources, `${JSON.stringify(sourceMeta, null, 2)}\n`);
    renderPatch(runClaude(buildPrompt(bundle, sources)), collected, tmp);
    validatePatch();
  }
  for (const line of readText(rationaleFile).split("\n")) {
    if (line) log(`rationale: ${line}`);
  }
  for (const item of JSON.parse(readText(statusFile))) {
    log(`${item.status}: ${item.path} (${item.sha256.slice(0, 12)})`);
  }
  process.stdout.write(readText(patchFile));
}

function appendLedger(): void {
  const { statusFile, patchFile, ledgerFile } = reflectionPaths();
  if (!existsSync(statusFile)) die(`status file not found; run preview first: ${statusFile}`);
  const statuses = JSON.parse(readText(statusFile));
  const seen = closedLedgerEntries(ledgerFile);
  const patchSha = createHash("sha256").update(existsSync(patchFile) ? readFileSync(patchFile) : Buffer.alloc(0)).digest("hex");
  const now = new Date().toISOString().replace("+00:00", "Z");
  for (const item of statuses) {
    const key = `${item.path}\0${item.sha256}`;
    if (seen.has(key)) continue;
    appendFileSync(
      ledgerFile,
      `${JSON.stringify(
        {
          timestamp: now,
          host: hostname(),
          path: item.path,
          sha256: item.sha256,
          bytes: item.bytes,
          status: item.status,
          rationale: item.rationale,
          patch_sha256: patchSha,
        },
        Object.keys({ timestamp: 1, host: 1, path: 1, sha256: 1, bytes: 1, status: 1, rationale: 1, patch_sha256: 1 }).sort(),
      )}\n`,
    );
  }
}

export function memoryReflectApply(): void {
  const { patchFile, ledgerFile } = reflectionPaths();
  if (!existsSync(patchFile)) die(`patch file not found; run preview first: ${patchFile}`);
  validatePatch();
  if (readText(patchFile).trim() !== "NO_CHANGES") {
    const result = spawnSync("git", ["-C", REPO_DIR, "apply", patchFile], { stdio: "inherit" });
    if (result.status !== 0) die(`git apply failed with exit ${result.status ?? 1}`);
  }
  appendLedger();
  log(readText(patchFile).trim() === "NO_CHANGES" ? "no doctrine changes needed" : `applied ${patchFile}`);
  spawnSync("git", ["-C", REPO_DIR, "diff", "--", "CLAUDE.md", "TASTE.md", basename(ledgerFile)], { stdio: "inherit" });
}

export function memoryReflectStatus(): void {
  const collected = collectMemory();
  for (const [state, records] of Object.entries(collected)) {
    const label = state === "skipped" ? "skipped" : state === "ignored" ? "ignored" : "pending";
    for (const item of records) {
      console.log(`${label}\t${item.path}\t${item.sha256.slice(0, 12)}`);
    }
  }
}

export function runMemoryReflect(command: string): void {
  if (command === "preview") memoryReflectPreview();
  else if (command === "apply") {
    memoryReflectPreview();
    memoryReflectApply();
  } else memoryReflectStatus();
}

export function runCodexMemoryReflect(command: string): void {
  process.env.CLAUDE_MEMORY_DIR ??= join(homedir(), ".codex", "memories");
  process.env.CLAUDE_PROJECTS_DIR ??= join("/tmp", "no-codex-project-memories");
  process.env.CLAUDE_MEMORY_PATCH ??= join(REPO_DIR, ".codex-memory-reflect.patch");
  process.env.CLAUDE_MEMORY_RATIONALE ??= join(REPO_DIR, ".codex-memory-reflect.rationale");
  process.env.CLAUDE_MEMORY_STATUSES ??= join(REPO_DIR, ".codex-memory-reflect.statuses.json");
  process.env.CLAUDE_MEMORY_LEDGER ??= join(REPO_DIR, "codex-memory-reflect-ledger.jsonl");
  runMemoryReflect(command);
}

export function runCursorMemoryReflect(command: string): void {
  exportMemoryDir();
  process.env.CLAUDE_MEMORY_DIR ??= join(homedir(), ".cursor", "memory");
  process.env.CLAUDE_PROJECTS_DIR ??= join("/tmp", "no-cursor-project-memories");
  process.env.CLAUDE_MEMORY_PATCH ??= join(REPO_DIR, ".cursor-memory-reflect.patch");
  process.env.CLAUDE_MEMORY_RATIONALE ??= join(REPO_DIR, ".cursor-memory-reflect.rationale");
  process.env.CLAUDE_MEMORY_STATUSES ??= join(REPO_DIR, ".cursor-memory-reflect.statuses.json");
  process.env.CLAUDE_MEMORY_LEDGER ??= join(REPO_DIR, "cursor-memory-reflect-ledger.jsonl");
  runMemoryReflect(command);
}

if (import.meta.main) {
  runMemoryReflect(process.argv[2] ?? "status");
}
