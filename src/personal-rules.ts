import { createHash } from "crypto";
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, unlinkSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { spawnSync } from "child_process";
import { REPO_DIR, readText, writeText } from "./lib.ts";

const MANIFEST_FILE = process.env.CURSOR_PERSONAL_RULES_MANIFEST ?? join(REPO_DIR, "cursor", "personal-rules", "manifest.json");
const RULES_DIR = join(dirname(MANIFEST_FILE), "rules");
const CURSOR_CLI_RULES_DIR = process.env.CURSOR_CLI_RULES_DIR ?? join(homedir(), ".cursor", "rules", "doctrine-synced");
const STATUSES_FILE = process.env.CURSOR_PERSONAL_RULES_STATUSES ?? join(REPO_DIR, ".cursor-personal-rules.statuses.json");
const SQLITE_CANDIDATES = [
  join(homedir(), ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
  join(homedir(), "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"),
  join(process.env.APPDATA ?? "", "Cursor", "User", "globalStorage", "state.vscdb"),
];

interface PersonalRule {
  slug: string;
  content: string;
  id?: string | null;
  sha256?: string;
}

function log(message: string): void {
  console.error(`[cursor-personal-rules] ${message}`);
}

function die(message: string): never {
  throw new Error(`[cursor-personal-rules] error: ${message}`);
}

function slugify(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return base || "rule";
}

function ruleHash(rule: PersonalRule): string {
  return rule.sha256 ?? createHash("sha256").update(rule.content).digest("hex");
}

function readJson(path: string): unknown {
  return existsSync(path) ? JSON.parse(readText(path)) : null;
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function readManifest(): PersonalRule[] {
  const data = readJson(MANIFEST_FILE) as { rules?: Record<string, string>[] } | null;
  if (!data) return [];
  const rules: PersonalRule[] = [];
  for (const item of data.rules ?? []) {
    const content = (item.content ?? "").trim();
    if (!content) continue;
    rules.push({
      slug: item.slug || slugify(content),
      content,
      id: item.id ?? null,
      sha256: item.sha256,
    });
  }
  return rules;
}

function writeManifest(rules: PersonalRule[]): void {
  const payload = {
    version: 1,
    updated_at: new Date().toISOString().replace("+00:00", "Z"),
    rules: rules.map((rule) => ({
      slug: rule.slug,
      id: rule.id,
      content: rule.content,
      sha256: ruleHash(rule),
    })),
  };
  writeJson(MANIFEST_FILE, payload);
  mkdirSync(RULES_DIR, { recursive: true });
  const desired = new Set(rules.map((r) => r.slug));
  for (const rule of rules) {
    writeText(join(RULES_DIR, `${rule.slug}.md`), `${rule.content.replace(/\s+$/, "")}\n`);
  }
  for (const path of readdirSync(RULES_DIR).filter((f) => f.endsWith(".md"))) {
    if (!desired.has(path.replace(/\.md$/, ""))) unlinkSync(join(RULES_DIR, path));
  }
}

function which(candidate: string): string | null {
  if (candidate.includes("/")) return existsSync(candidate) ? candidate : null;
  const r = spawnSync("which", [candidate], { encoding: "utf-8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function parseAgentEnvelope(stdout: string): Record<string, unknown> | null {
  try {
    const envelope = JSON.parse(stdout);
    let text: unknown = envelope.result ?? envelope.text ?? stdout;
    if (typeof text === "object" && text !== null) return text as Record<string, unknown>;
    if (typeof text === "string") {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    }
  } catch {
    return null;
  }
  return null;
}

function callAgentMcp(payload: Record<string, unknown>): Record<string, unknown> | null {
  const agent = which("agent") ?? which(join(homedir(), ".local/bin/agent"));
  if (!agent) return null;
  const action = payload.action;
  let prompt = `You are a non-interactive bridge. Call the cursor-app-control MCP tool \`manage_personal_rules\` with action \`${action}\`.`;
  if (action === "add") prompt += `\nContent:\n${payload.content ?? ""}`;
  else if (action === "update") prompt += `\nRule id \`${payload.id}\`. Content:\n${payload.content ?? ""}`;
  else if (action === "delete") prompt += `\nRule id \`${payload.id}\`.`;
  prompt +=
    '\nIf the tool is unavailable, return {"error":"manage_personal_rules unavailable"}. ' +
    'Otherwise return ONLY JSON: list -> {"rules":[{"id":"...","content":"..."}]}; ' +
    'add -> {"id":"..."}; update/delete -> {"ok":true}.';
  const workspace = process.env.CURSOR_AGENT_WORKSPACE ?? homedir();
  const proc = spawnSync(
    agent,
    ["-p", "--print", "--output-format", "json", "--approve-mcps", "--trust", "--force", "--workspace", workspace, prompt],
    { cwd: workspace, encoding: "utf-8" },
  );
  if (proc.status !== 0) return null;
  return parseAgentEnvelope(proc.stdout ?? "");
}

function readSqliteRules(): Record<string, unknown>[] {
  for (const dbPath of SQLITE_CANDIDATES) {
    if (!existsSync(dbPath)) continue;
    const db = new Database(`file:${dbPath}?mode=ro`, { readonly: true });
    try {
      const row = db.query("SELECT value FROM ItemTable WHERE key = ?").get("aicontext.personalContext") as { value?: string | Buffer } | null;
      if (!row?.value) continue;
      let raw = row.value;
      if (Buffer.isBuffer(raw)) raw = raw.toString("utf-8");
      try {
        const parsed = JSON.parse(String(raw));
        if (typeof parsed === "string") return parsed.trim() ? [{ content: parsed.trim() }] : [];
        if (Array.isArray(parsed)) return parsed.map((item) => (typeof item === "object" ? item : { content: String(item) }));
        if (parsed?.rules && Array.isArray(parsed.rules)) return parsed.rules;
      } catch {
        const text = String(raw).trim();
        if (text) return [{ content: text }];
      }
    } finally {
      db.close();
    }
  }
  return [];
}

function callBridge(action: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const payload = { action, ...extra };
  const custom = process.env.CURSOR_PERSONAL_RULES_MCP_CMD;
  if (custom) {
    const proc = spawnSync(custom, { input: JSON.stringify(payload), encoding: "utf-8" });
    if (proc.status !== 0) die(proc.stderr?.trim() || `bridge command failed: ${custom}`);
    return JSON.parse(proc.stdout!);
  }
  if (action === "list") {
    const mcp = callAgentMcp({ action: "list" });
    if (mcp !== null) {
      if (mcp.error) return { rules: [], error: mcp.error };
      return mcp;
    }
    const rules = readSqliteRules();
    if (rules.length) return { rules, source: "sqlite" };
    return { rules: [], error: "manage_personal_rules unavailable in cursor-cli on this host" };
  }
  if (action === "add") {
    const mcp = callAgentMcp({ action: "add", content: extra.content });
    if (mcp !== null && !mcp.error) return mcp;
    return { error: "cannot add personal rule without manage_personal_rules MCP" };
  }
  if (action === "update") {
    const mcp = callAgentMcp({ action: "update", id: extra.id, content: extra.content });
    if (mcp !== null && !mcp.error) return mcp;
    return { error: "cannot update personal rule without manage_personal_rules MCP" };
  }
  if (action === "delete") {
    const mcp = callAgentMcp({ action: "delete", id: extra.id });
    if (mcp !== null && !mcp.error) return mcp;
    return { error: "cannot delete personal rule without manage_personal_rules MCP" };
  }
  die(`unknown action: ${action}`);
}

function normalizeRemoteRules(data: Record<string, unknown>): PersonalRule[] {
  if (data.error) return [];
  let rawRules = data.rules;
  if (rawRules === undefined && Array.isArray(data.items)) rawRules = data.items;
  if (rawRules === undefined && Array.isArray(data as unknown as unknown[])) rawRules = data as unknown as unknown[];
  if (rawRules !== undefined && !Array.isArray(rawRules)) die("malformed bridge list output");
  if (!Array.isArray(rawRules)) return [];
  const out: PersonalRule[] = [];
  for (const item of rawRules) {
    if (typeof item === "string") {
      const content = item.trim();
      if (content) out.push({ slug: slugify(content), content });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, string>;
    const content = (obj.content ?? obj.text ?? obj.rule ?? "").trim();
    if (!content) continue;
    out.push({
      slug: obj.slug || slugify(content),
      content,
      id: obj.id ?? obj.rule_id ?? obj.uuid ?? null,
    });
  }
  return out;
}

function mergeRules(...groups: PersonalRule[][]): PersonalRule[] {
  const merged = new Map<string, PersonalRule>();
  for (const group of groups) {
    for (const rule of group) merged.set(ruleHash(rule), rule);
  }
  return [...merged.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

function listFromMcp(): PersonalRule[] {
  return normalizeRemoteRules(callBridge("list"));
}

function listFromLiveMcp(): PersonalRule[] | null {
  const custom = process.env.CURSOR_PERSONAL_RULES_MCP_CMD;
  if (custom) {
    const proc = spawnSync(custom, { input: JSON.stringify({ action: "list" }), encoding: "utf-8" });
    if (proc.status !== 0) return null;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(proc.stdout!);
    } catch {
      return null;
    }
    if (data.error) return null;
    return normalizeRemoteRules(data);
  }
  const mcp = callAgentMcp({ action: "list" });
  if (mcp === null || mcp.error) return null;
  return normalizeRemoteRules(mcp);
}

function listFromSqlite(): PersonalRule[] {
  return normalizeRemoteRules({ rules: readSqliteRules() });
}

function listFromCliFiles(): PersonalRule[] {
  if (!existsSync(CURSOR_CLI_RULES_DIR)) return [];
  const out: PersonalRule[] = [];
  for (const file of readdirSync(CURSOR_CLI_RULES_DIR).filter((f) => f.endsWith(".mdc")).sort()) {
    let content = readText(join(CURSOR_CLI_RULES_DIR, file)).trim();
    if (!content) continue;
    if (content.startsWith("---\n")) {
      const end = content.indexOf("\n---\n", 4);
      if (end !== -1) content = content.slice(end + "\n---\n".length).trim();
    }
    out.push({ slug: file.replace(/\.mdc$/, ""), content });
  }
  return out;
}

function writeCliFiles(rules: PersonalRule[]): void {
  mkdirSync(CURSOR_CLI_RULES_DIR, { recursive: true });
  const desired = new Set(rules.map((r) => r.slug));
  for (const rule of rules) {
    writeText(
      join(CURSOR_CLI_RULES_DIR, `${rule.slug}.mdc`),
      `---\ndescription: Synced Cursor personal preference from claude-md repo\nalwaysApply: true\n---\n\n${rule.content.replace(/\s+$/, "")}\n`,
    );
  }
  for (const file of readdirSync(CURSOR_CLI_RULES_DIR).filter((f) => f.endsWith(".mdc"))) {
    if (!desired.has(file.replace(/\.mdc$/, ""))) unlinkSync(join(CURSOR_CLI_RULES_DIR, file));
  }
}

function addViaMcp(content: string): PersonalRule {
  const data = callBridge("add", { content });
  if (data.error) die(String(data.error));
  return { slug: String(data.slug ?? slugify(content)), content: content.trim(), id: String(data.id ?? data.rule_id ?? "") || null };
}

function updateViaMcp(ruleId: string, content: string): void {
  const data = callBridge("update", { id: ruleId, content });
  if (data.error) die(String(data.error));
  if (data.ok !== true) die("malformed bridge update output");
}

function deleteViaMcp(ruleId: string): void {
  const data = callBridge("delete", { id: ruleId });
  if (data.error) die(String(data.error));
  if (data.ok !== true) die("malformed bridge delete output");
}

function exportSources(): [PersonalRule[], string] {
  const cliRules = listFromCliFiles();
  const mcpRules = listFromMcp();
  if (mcpRules.length) {
    return [mergeRules(mcpRules, cliRules), cliRules.length ? "mcp+cli" : "mcp"];
  }
  const sqliteRules = listFromSqlite();
  if (sqliteRules.length) return [mergeRules(sqliteRules, cliRules), cliRules.length ? "sqlite+cli" : "sqlite"];
  if (cliRules.length) return [cliRules, "cli"];
  return [[], "empty"];
}

function reconcileMcp(remote: PersonalRule[], desired: PersonalRule[]): Record<string, number> {
  const counts = { add: 0, update: 0, delete: 0, unchanged: 0 };
  const remoteByHash = Object.fromEntries(remote.map((r) => [ruleHash(r), r]));
  const desiredHashes = new Set(desired.map(ruleHash));
  const seenIds = new Set<string>();
  for (const rule of desired) {
    const existing = remoteByHash[ruleHash(rule)];
    if (existing) {
      counts.unchanged++;
      if (existing.id) {
        seenIds.add(existing.id);
        rule.id = existing.id;
      }
      continue;
    }
    const match = remote.find((r) => r.content.trim() === rule.content.trim() && r.id);
    if (match) {
      counts.unchanged++;
      seenIds.add(match.id!);
      rule.id = match.id;
      continue;
    }
    const created = addViaMcp(rule.content);
    rule.id = created.id;
    counts.add++;
    if (created.id) seenIds.add(created.id);
  }
  for (const rule of remote) {
    if (!rule.id || seenIds.has(rule.id)) continue;
    if (!desiredHashes.has(ruleHash(rule))) {
      deleteViaMcp(rule.id);
      counts.delete++;
    }
  }
  return counts;
}

function applyCli(rules: PersonalRule[]): void {
  writeCliFiles(rules);
  log(`applied ${rules.length} personal rule(s) to cursor-cli path ${CURSOR_CLI_RULES_DIR}`);
}

export function exportMcp(): number {
  const [rules, source] = exportSources();
  writeManifest(rules);
  writeCliFiles(rules);
  writeJson(STATUSES_FILE, { source, count: rules.length, rules });
  log(`exported ${rules.length} personal rule(s) from ${source} -> ${MANIFEST_FILE}`);
  return 0;
}

export function applyMcp(): number {
  const desired = readManifest();
  applyCli(desired);
  if (!desired.length) {
    log("no personal rules in repo manifest");
    return 0;
  }
  let remote: PersonalRule[] | null;
  try {
    remote = listFromLiveMcp();
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("[cursor-personal-rules] error:")) throw e;
    remote = null;
  }
  if (remote === null) {
    writeJson(STATUSES_FILE, { target: "cli", mcp: "unavailable", count: desired.length });
    log("mcp unavailable on cursor-cli; cli file rules are active");
    return 0;
  }
  const counts = reconcileMcp(remote, desired);
  writeManifest(desired);
  writeJson(STATUSES_FILE, { target: "cli+mcp", counts });
  log(`applied personal rules to cli files and MCP: ${JSON.stringify(counts)}`);
  return 0;
}

export function syncPersonalRules(): number {
  const repoRules = readManifest();
  const cliRules = listFromCliFiles();
  const mcpRules = listFromMcp();
  const mergedRemote = mergeRules(mcpRules, cliRules);
  const repoHashes = new Set(repoRules.map(ruleHash));
  const remoteHashes = new Set(mergedRemote.map(ruleHash));
  const setsDiffer =
    repoHashes.size !== remoteHashes.size || [...remoteHashes].some((h) => !repoHashes.has(h));
  if (mergedRemote.length && setsDiffer) {
    writeManifest(mergedRemote);
    writeCliFiles(mergedRemote);
    log(`sync: exported ${mergedRemote.length} rule(s) from ${mcpRules.length ? "mcp" : "cli"} to repo`);
    return 0;
  }
  if (repoRules.length) {
    applyMcp();
    log(`sync: applied ${repoRules.length} rule(s) from repo`);
    return 0;
  }
  writeCliFiles([]);
  log("sync: no personal rules configured yet");
  return 0;
}

export function exportMemoryDir(): number {
  const memoryDir = process.env.CURSOR_MEMORY_DIR ?? join(homedir(), ".cursor", "memory");
  const rules = readManifest();
  mkdirSync(memoryDir, { recursive: true });
  for (const path of readdirSync(memoryDir).filter((f) => f.startsWith("personal-rule-") && f.endsWith(".md"))) {
    unlinkSync(join(memoryDir, path));
  }
  rules.forEach((rule, idx) => {
    writeText(join(memoryDir, `personal-rule-${String(idx + 1).padStart(3, "0")}-${rule.slug}.md`), `${rule.content.replace(/\s+$/, "")}\n`);
  });
  log(`exported ${rules.length} personal rule(s) to ${memoryDir} for reflection`);
  return 0;
}

export function personalRulesStatus(): number {
  const repoRules = readManifest();
  const cliRules = listFromCliFiles();
  console.log(`repo\t${repoRules.length}\t${MANIFEST_FILE}`);
  console.log(`cli\t${cliRules.length}\t${CURSOR_CLI_RULES_DIR}`);
  try {
    const mcpRules = listFromMcp();
    console.log(`mcp\t${mcpRules.length}\tmanage_personal_rules`);
  } catch (exc) {
    console.log(`mcp\tunavailable\t${exc}`);
  }
  return 0;
}

export function runPersonalRulesSync(command: string): number {
  if (command === "status") return personalRulesStatus();
  if (command === "export-mcp") return exportMcp();
  if (command === "apply-mcp") return applyMcp();
  if (command === "apply-cli") {
    applyCli(readManifest());
    return 0;
  }
  if (command === "sync") return syncPersonalRules();
  if (command === "export-memory") return exportMemoryDir();
  return personalRulesStatus();
}
