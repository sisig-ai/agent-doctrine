#!/usr/bin/env bun
// authored handoff core and cli: one self-contained processor.
//
// an agent submits a delta of ordered blocks. `exact` blocks keep every byte.
// `prose` blocks are written authored by default, with no child call. an
// explicit `--compress` request compresses prose once by the caller's native
// harness in a bounded isolated child. existing history stays byte-exact. a
// per-note lock spans verification and write. every write carries a receipt
// bound to the absolute note path, rule version, revision, harness, model,
// content hash, and the last delta's processing mode.

import { spawnSync } from "child_process";
import { createHash, randomBytes } from "crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "fs";
import { basename, dirname, isAbsolute, join, resolve } from "path";
import { tmpdir } from "os";

export const RULE_VERSION = "handoff-compress-v3";
export const HARNESSES = ["claude", "opencode"] as const;
export type Harness = (typeof HARNESSES)[number];
export type Processing = "authored" | "native-compressed";

// --- small fs helpers ---------------------------------------------------

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

export function atomicWrite(path: string, data: string | Buffer, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(8).toString("hex")}`);
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
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
      /* temp was renamed or never created */
    }
  }
}

function sleepSync(ms: number): void {
  const BunSleep = (globalThis as { Bun?: { sleepSync?: (ms: number) => void } }).Bun?.sleepSync;
  if (BunSleep) {
    BunSleep(ms);
    return;
  }
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy wait keeps the lock loop synchronous */
  }
}

/**
 * Run `fn` while holding an exclusive per-note lock. The lock covers the slow
 * child call, so two writers serialize instead of losing an update.
 */
export function withLock<T>(lockPath: string, fn: () => T, timeoutMs = 120_000): T {
  mkdirSync(dirname(lockPath), { recursive: true });
  const start = Date.now();
  let fd: number | undefined;
  for (;;) {
    try {
      fd = openSync(lockPath, "wx");
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (Date.now() - start > timeoutMs) throw new Error(`lock timeout after ${timeoutMs}ms: ${lockPath}`);
      sleepSync(25);
    }
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      /* lock already removed */
    }
  }
}

// --- delta model --------------------------------------------------------

export type BlockKind = "exact" | "prose";

export interface Block {
  kind: BlockKind;
  text: string;
}

export interface HandoffDelta {
  section?: string;
  blocks: Block[];
}

const TOP_KEYS = new Set(["section", "blocks"]);
const BLOCK_KEYS = new Set(["kind", "text"]);

export function parseDelta(raw: string): HandoffDelta {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`delta is not valid json: ${(e as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("delta must be a json object");
  }
  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!TOP_KEYS.has(key)) throw new Error(`delta has unknown key: ${key}`);
  }
  if (record.section !== undefined && typeof record.section !== "string") {
    throw new Error("delta.section must be a string");
  }
  if (!Array.isArray(record.blocks) || record.blocks.length === 0) {
    throw new Error("delta.blocks must be a non-empty array");
  }
  const blocks: Block[] = record.blocks.map((entry, i) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`delta.blocks[${i}] must be an object`);
    }
    const block = entry as Record<string, unknown>;
    for (const key of Object.keys(block)) {
      if (!BLOCK_KEYS.has(key)) throw new Error(`delta.blocks[${i}] has unknown key: ${key}`);
    }
    if (block.kind !== "exact" && block.kind !== "prose") {
      throw new Error(`delta.blocks[${i}].kind must be "exact" or "prose"`);
    }
    if (typeof block.text !== "string") throw new Error(`delta.blocks[${i}].text must be a string`);
    return { kind: block.kind, text: block.text };
  });
  if (blocks.every((block) => block.text.trim() === "")) {
    throw new Error("delta carries no material: every block is empty");
  }
  return record.section === undefined ? { blocks } : { section: record.section, blocks };
}

// --- compression children ----------------------------------------------

export interface ChildResult {
  text: string;
  harness: string;
  model: string;
  elapsedMs: number;
  usage: unknown;
  costUsd?: number;
  sessionID?: string;
}

export interface CompressOptions {
  harness: Harness;
  model: string;
  timeoutMs?: number;
  /**
   * explicit native compression request. default false: the write persists the
   * authored bytes with no child call. true runs the same-harness compressor.
   */
  compress?: boolean;
  /** test seam: replace the native child with a deterministic executor. */
  executor?: (prose: string, opts: { harness: Harness; model: string }) => string;
  /** test seam: replace the native recipient call. */
  recipientExecutor?: (prompt: string) => string;
}

// compression guidance adapted from wilpel/caveman-compression
// (SPEC.md, prompts/compression.txt): strip articles and filler, keep facts
// and every logical relationship. https://github.com/wilpel/caveman-compression
export const COMPRESSION_SYSTEM_PROMPT = [
  "you compress technical handoff prose.",
  "compress each PROSE block: remove articles, filler, and repetition.",
  "keep every fact, number, path, identifier, command, condition, and negation.",
  "keep uncertainty words such as may, might, likely, probably, could, appears, seems.",
  "keep every @@HANDOFF_PROSE n@@ and @@HANDOFF_END n@@ marker line exactly as written, in order.",
  "output only the marked blocks. no preamble, no explanation, no tools.",
].join("\n");

export const COMPRESSOR_AGENT = [
  "---",
  "description: Compresses handoff prose. No tools.",
  "mode: primary",
  "permissions:",
  '  - action: "*"',
  '    resource: "*"',
  "    effect: deny",
  "---",
  "",
  COMPRESSION_SYSTEM_PROMPT,
  "",
].join("\n");

export const RECIPIENT_SYSTEM_PROMPT = [
  "answer each numbered question using only the provided document.",
  "output one line per question, exactly `N|<answer>`.",
  "use the document's own words.",
  "if the document does not answer a question, output `N|unsupported`.",
  "do not use tools.",
].join("\n");

export const RECIPIENT_AGENT = [
  "---",
  "description: Answers questions from a provided document. No tools.",
  "mode: primary",
  "permissions:",
  '  - action: "*"',
  '    resource: "*"',
  "    effect: deny",
  "---",
  "",
  RECIPIENT_SYSTEM_PROMPT,
  "",
].join("\n");

export interface ChildProject {
  dir: string;
  configHome: string;
  cleanup: () => void;
}

/** create an isolated opencode project that exposes only the compressor agent. */
export function createChildProject(): ChildProject {
  const dir = mkdtempSync(join(tmpdir(), "handoff-child-"));
  const configRoot = join(dir, ".config", "opencode");
  mkdirSync(join(configRoot, "agents"), { recursive: true });
  writeFileSync(join(configRoot, "agents", "handoff-compressor.md"), COMPRESSOR_AGENT);
  writeFileSync(join(configRoot, "agents", "handoff-recipient.md"), RECIPIENT_AGENT);
  writeFileSync(join(configRoot, "opencode.json"), `${JSON.stringify({ $schema: "https://opencode.ai/config.json" })}\n`);
  return {
    dir,
    configHome: join(dir, ".config"),
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* temp dir already gone */
      }
    },
  };
}

export function compressionArgv(harness: Harness, model: string, prompt: string): string[] {
  if (harness === "claude") {
    // --safe-mode drops user hooks and customisations while keeping auth.
    return [
      "claude",
      "-p",
      "--safe-mode",
      "--output-format",
      "json",
      "--tools",
      "",
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--no-session-persistence",
      "--system-prompt",
      COMPRESSION_SYSTEM_PROMPT,
      "--max-budget-usd",
      "0.50",
      "--model",
      model,
      prompt,
    ];
  }
  return ["opencode", "run", "--standalone", "--format", "json", "--agent", "handoff-compressor", "--model", model, prompt];
}

function parseClaudeResult(stdout: string): { text: string; usage: unknown; costUsd?: number } {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(stdout) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`claude child returned non-json: ${(e as Error).message}`);
  }
  if (payload.is_error === true || payload.subtype === "error") {
    throw new Error(`claude child failed: ${JSON.stringify(payload).slice(0, 400)}`);
  }
  const text = typeof payload.result === "string" ? payload.result : "";
  if (!text.trim()) throw new Error("claude child returned empty result");
  return { text, usage: payload.usage ?? null, costUsd: typeof payload.total_cost_usd === "number" ? payload.total_cost_usd : undefined };
}

function parseOpencodeResult(stdout: string): { text: string; usage: unknown; costUsd?: number; sessionID?: string } {
  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  let text = "";
  let usage: unknown = null;
  let costUsd: number | undefined;
  let sessionID: string | undefined;
  let parsedAny = false;
  for (const line of lines) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    parsedAny = true;
    if (typeof event.sessionID === "string") sessionID = event.sessionID;
    const part = event.part as Record<string, unknown> | undefined;
    if (event.type === "text" && typeof part?.text === "string") text += part.text;
    const u = event.usage ?? part?.usage ?? event.tokens ?? part?.tokens;
    if (u) usage = u;
    const c = event.cost ?? part?.cost ?? event.total_cost_usd;
    if (typeof c === "number") costUsd = c;
  }
  if (!parsedAny) throw new Error(`opencode child returned non-json: ${stdout.slice(0, 400)}`);
  if (!text.trim()) throw new Error(`opencode child returned no text: ${stdout.slice(0, 400)}`);
  return { text, usage, costUsd, sessionID };
}

function spawnNative(argv: string[], harness: Harness, model: string, timeoutMs: number, label: string): ChildResult {
  const project = harness === "opencode" ? createChildProject() : undefined;
  const started = Date.now();
  const env: NodeJS.ProcessEnv = { ...process.env, HANDOFF_COMPRESS_CHILD: "1", HANDOFF_GUARD_DISABLE: "1" };
  if (project) env.XDG_CONFIG_HOME = project.configHome;
  let result;
  try {
    result = spawnSync(argv[0]!, argv.slice(1), {
      cwd: project?.dir,
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      env,
    });
  } finally {
    project?.cleanup();
  }
  const elapsedMs = Date.now() - started;
  if (result.error || result.signal) {
    const err = result.error as NodeJS.ErrnoException | undefined;
    if (result.signal || err?.code === "ETIMEDOUT") {
      throw new Error(`${label} child timed out (${harness}) after ${elapsedMs}ms`);
    }
    throw new Error(`${label} child failed to run (${harness}): ${err?.message ?? "unknown error"}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} child exited ${result.status} (${harness}): ${(result.stderr ?? "").trim().slice(0, 500)}`);
  }
  const stdout = (result.stdout ?? "").trim();
  if (!stdout) throw new Error(`${label} child produced no output (${harness})`);
  const parsed = harness === "claude" ? parseClaudeResult(stdout) : parseOpencodeResult(stdout);
  return { ...parsed, harness, model, elapsedMs };
}

export function compressText(prose: string, opts: CompressOptions): ChildResult {
  if (opts.executor) {
    return { text: opts.executor(prose, opts), harness: opts.harness, model: opts.model, elapsedMs: 0, usage: null };
  }
  return spawnNative(compressionArgv(opts.harness, opts.model, prose), opts.harness, opts.model, opts.timeoutMs ?? 180_000, "compression");
}

export function recipientArgv(harness: Harness, model: string, prompt: string): string[] {
  if (harness === "claude") {
    return [
      "claude",
      "-p",
      "--safe-mode",
      "--output-format",
      "json",
      "--tools",
      "",
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--no-session-persistence",
      "--system-prompt",
      RECIPIENT_SYSTEM_PROMPT,
      "--max-budget-usd",
      "0.50",
      "--model",
      model,
      prompt,
    ];
  }
  return ["opencode", "run", "--standalone", "--format", "json", "--agent", "handoff-recipient", "--model", model, prompt];
}

/** run a native recipient call that answers the rubric from one document. */
export function runRecipient(document: string, questions: { id: number; question: string }[], opts: CompressOptions): ChildResult {
  const prompt = `${RECIPIENT_SYSTEM_PROMPT}\n\nDOCUMENT:\n${document}\n\nQUESTIONS:\n${questions
    .map((q) => `${q.id}. ${q.question}`)
    .join("\n")}`;
  if (opts.recipientExecutor) {
    return { text: opts.recipientExecutor(prompt), harness: opts.harness, model: opts.model, elapsedMs: 0, usage: null };
  }
  return spawnNative(recipientArgv(opts.harness, opts.model, prompt), opts.harness, opts.model, opts.timeoutMs ?? 180_000, "recipient");
}

export function parseRecipientAnswers(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of text.split("\n")) {
    const match = line.match(/^(\d+)\s*\|\s*(.*)$/);
    if (match) out.set(Number(match[1]), match[2]!.trim());
  }
  return out;
}

/**
 * read native token usage from an exported session using documented shapes:
 * `tokens: { input, output }` or `usage: { input_tokens, output_tokens }`.
 * returns an explicit error instead of silently reporting no usage.
 */
export function exportSessionUsage(sessionID: string): { usage: unknown; costUsd?: number; error: string | null } {
  const run = spawnSync("opencode", ["session", "export", sessionID, "--standalone"], {
    encoding: "utf-8",
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (run.error) return { usage: null, error: `export failed to run: ${run.error.message}` };
  if (run.status !== 0) return { usage: null, error: `export exited ${run.status}: ${(run.stderr ?? "").trim().slice(0, 300)}` };
  if (!run.stdout) return { usage: null, error: "export produced no output" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.stdout);
  } catch (e) {
    return { usage: null, error: `export is not valid json: ${(e as Error).message}` };
  }
  let usage: unknown = null;
  let costUsd: number | undefined;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const record = node as Record<string, unknown>;
    const tokens = record.tokens as Record<string, unknown> | undefined;
    if (tokens && typeof tokens.input === "number" && typeof tokens.output === "number") {
      usage = { input: tokens.input, output: tokens.output };
    }
    const usageField = record.usage as Record<string, unknown> | undefined;
    if (usageField && typeof usageField.input_tokens === "number" && typeof usageField.output_tokens === "number") {
      usage = { input_tokens: usageField.input_tokens, output_tokens: usageField.output_tokens };
    }
    for (const value of Object.values(record)) visit(value);
  };
  visit(parsed);
  const cost = findPositiveCost(parsed);
  if (cost !== undefined) costUsd = cost;
  return { usage, costUsd, error: null };
}

function findPositiveCost(node: unknown): number | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findPositiveCost(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (/^(cost|costUsd|total_cost_usd)$/.test(key) && typeof value === "number" && value > 0) return value;
    const found = findPositiveCost(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

// --- block compression --------------------------------------------------

const PROSE_OPEN = (n: number) => `@@HANDOFF_PROSE ${n}@@`;
const PROSE_END = (n: number) => `@@HANDOFF_END ${n}@@`;

/** build the payload sent to the child: only prose blocks, each marked. */
export function prosePayload(delta: HandoffDelta): { payload: string; proseCount: number } {
  const prose = delta.blocks.filter((block) => block.kind === "prose");
  const parts = prose.map((block, i) => `${PROSE_OPEN(i)}\n${block.text}\n${PROSE_END(i)}`);
  return { payload: parts.join("\n"), proseCount: prose.length };
}

/** split the child output back into per-prose-block text, strictly. */
export function parseProseOutput(output: string, count: number): string[] {
  const lines = output.split("\n");
  const results: string[] = [];
  let current: string[] | undefined;
  let open = -1;
  for (const line of lines) {
    const openMatch = line.match(/^@@HANDOFF_PROSE (\d+)@@$/);
    const endMatch = line.match(/^@@HANDOFF_END (\d+)@@$/);
    if (openMatch) {
      if (current) throw new Error("child output has a nested prose marker");
      open = Number(openMatch[1]);
      if (open !== results.length) throw new Error(`child prose marker ${open} is out of order or duplicated`);
      current = [];
      continue;
    }
    if (endMatch) {
      if (!current) throw new Error("child output has an end marker without a start");
      if (Number(endMatch[1]) !== open) throw new Error("child output has mismatched prose markers");
      results.push(current.join("\n"));
      current = undefined;
      open = -1;
      continue;
    }
    if (current) current.push(line);
    else if (line.trim()) throw new Error("child output has text outside a prose block");
  }
  if (current) throw new Error("child output has an unterminated prose block");
  if (results.length !== count) throw new Error(`child returned ${results.length} prose blocks, expected ${count}`);
  if (results.some((text) => text === "")) throw new Error("child returned an empty prose block");
  return results;
}

export interface BuiltDelta {
  block: string;
  prose: string[];
  child: ChildResult | null;
}

/** render the delta bytes: exact blocks verbatim, prose authored or compressed on request. */
export function buildDeltaBlock(
  delta: HandoffDelta,
  opts: CompressOptions,
  now: string,
  framing: "create" | "append" = "append",
): BuiltDelta {
  const authoredProse = delta.blocks.filter((b) => b.kind === "prose").map((b) => b.text);
  // default: persist authored bytes. no child, no model call.
  // an exact-only explicit request also skips the child and uses the same framing.
  const needsChild = opts.compress === true && authoredProse.length > 0;
  if (!needsChild) {
    return { block: renderDelta(delta, now, framing), prose: authoredProse, child: null };
  }
  const { payload, proseCount } = prosePayload(delta);
  let compressed: string[] = authoredProse;
  let child: ChildResult | null = null;
  if (proseCount > 0 && payload.trim()) {
    child = compressText(payload, opts);
    compressed = parseProseOutput(child.text, proseCount);
  }
  let proseIndex = 0;
  const rendered = delta.blocks.map((block) => (block.kind === "exact" ? block.text : compressed[proseIndex++]!));
  const header = delta.section ? `### ${delta.section} ${now}\n\n` : "";
  const prefix = framing === "create" ? header : header ? `\n\n${header}` : "\n\n";
  const body = rendered.join("\n");
  return { block: `${prefix}${body}\n`, prose: compressed, child };
}

/** render a delta with prose left uncompressed, using the same framing. */
export function renderDelta(delta: HandoffDelta, now: string, framing: "create" | "append" = "append"): string {
  const rendered = delta.blocks.map((block) => block.text);
  const header = delta.section ? `### ${delta.section} ${now}\n\n` : "";
  const prefix = framing === "create" ? header : header ? `\n\n${header}` : "\n\n";
  return `${prefix}${rendered.join("\n")}\n`;
}

// --- receipts -----------------------------------------------------------

export interface Receipt {
  rule_version: string;
  note: string;
  revision: number;
  note_sha256: string;
  harness: string;
  model: string;
  /** processing of the last committed delta: authored or native-compressed. */
  processing: Processing;
}

interface ReceiptValidation {
  ok: boolean;
  reason?: string;
  receipt?: Receipt;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** validate a receipt's shape, path binding, and optional required harness. */
export function validateReceipt(
  receipt: Receipt | undefined,
  notePath: string,
  requireHarness?: Harness,
): ReceiptValidation {
  if (!receipt) return { ok: false, reason: `no receipt for note: ${notePath}` };
  if (receipt.rule_version !== RULE_VERSION) {
    return { ok: false, reason: `receipt rule version ${receipt.rule_version} != ${RULE_VERSION}` };
  }
  if (receipt.note !== resolve(notePath)) {
    return { ok: false, reason: `receipt is bound to ${receipt.note}, not ${resolve(notePath)}` };
  }
  if (!Number.isInteger(receipt.revision) || receipt.revision < 1) {
    return { ok: false, reason: `receipt revision is not a positive integer: ${receipt.revision}` };
  }
  if (!HEX64.test(receipt.note_sha256)) return { ok: false, reason: "receipt note_sha256 is malformed" };
  if (!HARNESSES.includes(receipt.harness as Harness)) {
    return { ok: false, reason: `receipt harness is unknown: ${receipt.harness}` };
  }
  if (requireHarness && receipt.harness !== requireHarness) {
    return { ok: false, reason: `receipt harness ${receipt.harness} != required ${requireHarness}` };
  }
  if (typeof receipt.model !== "string" || !receipt.model) {
    return { ok: false, reason: "receipt model is missing" };
  }
  if (receipt.processing !== "authored" && receipt.processing !== "native-compressed") {
    return { ok: false, reason: `receipt processing is not authored or native-compressed: ${String(receipt.processing)}` };
  }
  return { ok: true, receipt };
}

export function receiptPath(notePath: string): string {
  return `${resolve(notePath)}.receipt.json`;
}

export function readReceipt(notePath: string): Receipt | undefined {
  const path = receiptPath(notePath);
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(path));
  } catch (e) {
    throw new Error(`receipt is not valid json (${path}): ${(e as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error(`receipt is malformed: ${path}`);
  return parsed as Receipt;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  receipt?: Receipt;
}

export function verifyReceipt(notePath: string, opts: { requireHarness?: Harness } = {}): VerifyResult {
  const note = resolve(notePath);
  if (!existsSync(note)) return { ok: false, reason: `note is missing: ${note}` };
  const validated = validateReceipt(readReceipt(note) as Receipt | undefined, note, opts.requireHarness);
  if (!validated.ok) return validated;
  const receipt = validated.receipt!;
  const actual = sha256(readFileSync(note));
  if (actual !== receipt.note_sha256) return { ok: false, reason: `note changed since receipt (stale): ${note}`, receipt };
  return { ok: true, receipt };
}

export interface WriteResult {
  notePath: string;
  receipt: Receipt;
  built: BuiltDelta;
}

function requireHarnessModel(opts: CompressOptions): void {
  if (!HARNESSES.includes(opts.harness)) {
    throw new Error(`harness must be one of ${HARNESSES.join(", ")}; got ${String(opts.harness)}`);
  }
  if (typeof opts.model !== "string" || !opts.model.trim()) {
    throw new Error("model is required: the receipt must record the actual model");
  }
}

function writeReceipt(receipt: Receipt): void {
  atomicWrite(receiptPath(receipt.note), `${JSON.stringify(receipt, null, 2)}\n`);
}

function makeReceipt(note: string, revision: number, built: BuiltDelta, opts: CompressOptions): Receipt {
  const child = built.child;
  return {
    rule_version: RULE_VERSION,
    note,
    revision,
    note_sha256: sha256(readFileSync(note)),
    harness: child?.harness ?? opts.harness,
    model: child?.model ?? opts.model,
    // a child ran only on an explicit compression request with prose material.
    processing: child ? "native-compressed" : "authored",
  };
}

export function createNote(notePath: string, delta: HandoffDelta, opts: CompressOptions): WriteResult {
  requireHarnessModel(opts);
  const note = resolve(notePath);
  const lock = `${note}.lock`;
  return withLock(lock, () => {
    if (existsSync(note)) throw new Error(`create: note already exists: ${note}`);
    const now = new Date().toISOString();
    const built = buildDeltaBlock(delta, opts, now, "create");
    atomicWrite(note, built.block);
    const receipt = makeReceipt(note, 1, built, opts);
    writeReceipt(receipt);
    return { notePath: note, receipt, built };
  });
}

export interface AppendOptions extends CompressOptions {
  expectRevision?: number;
}

export function appendNote(notePath: string, delta: HandoffDelta, opts: AppendOptions): WriteResult {
  requireHarnessModel(opts);
  const note = resolve(notePath);
  const lock = `${note}.lock`;
  return withLock(lock, () => {
    if (!existsSync(note)) throw new Error(`append: note is missing: ${note}`);
    const validated = validateReceipt(readReceipt(note) as Receipt | undefined, note);
    if (!validated.ok) throw new Error(`append: ${validated.reason}`);
    const previous = validated.receipt!;
    const currentHash = sha256(readFileSync(note));
    if (currentHash !== previous.note_sha256) {
      throw new Error(`append: note changed since last receipt (concurrent or manual edit): ${note}`);
    }
    if (opts.expectRevision !== undefined && opts.expectRevision !== previous.revision) {
      throw new Error(`append: expected revision ${opts.expectRevision} but note is at ${previous.revision}`);
    }
    const now = new Date().toISOString();
    const built = buildDeltaBlock(delta, opts, now);
    // post-compression check: the child call is slow, so re-read and compare.
    const afterHash = sha256(readFileSync(note));
    if (afterHash !== currentHash) {
      throw new Error(`append: note changed during compression (concurrent writer): ${note}`);
    }
    const next = Buffer.concat([readFileSync(note), Buffer.from(built.block, "utf-8")]);
    atomicWrite(note, next);
    const receipt = makeReceipt(note, previous.revision + 1, built, opts);
    writeReceipt(receipt);
    return { notePath: note, receipt, built };
  });
}

// --- delegation pointer -------------------------------------------------

export interface Pointer {
  note: string;
}

/**
 * parse a structured pointer line: `handoff: {"note":"/abs/path.md"}`.
 * json keeps paths with spaces intact. returns undefined for a non-pointer line.
 */
export function parsePointerLine(line: string): Pointer | undefined {
  const match = line.match(/^handoff:\s*(\{.*\})\s*$/);
  if (!match) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]!);
  } catch {
    throw new Error(`handoff pointer is not valid json: ${line}`);
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("handoff pointer must be an object");
  const note = (parsed as { note?: unknown }).note;
  if (typeof note !== "string" || !note) throw new Error("handoff pointer must carry a note string");
  if (!isAbsolute(note)) throw new Error(`handoff pointer must be an absolute path: ${note}`);
  return { note };
}

export function parsePointers(text: string): Pointer[] {
  const pointers: Pointer[] = [];
  for (const line of text.split("\n")) {
    const pointer = parsePointerLine(line.trim());
    if (pointer) pointers.push(pointer);
  }
  return pointers;
}

export interface PointerCheck {
  note: string;
  ok: boolean;
  reason?: string;
  harness?: string;
  model?: string;
}

export function checkPointers(text: string, requireHarness?: Harness): PointerCheck[] {
  return parsePointers(text).map((pointer) => {
    const verdict = verifyReceipt(pointer.note, requireHarness ? { requireHarness } : {});
    if (!verdict.ok) return { note: pointer.note, ok: false, reason: verdict.reason };
    return { note: pointer.note, ok: true, harness: verdict.receipt!.harness, model: verdict.receipt!.model };
  });
}

/** one delegation must carry exactly one valid pointer, optionally of a required harness. */
export function enforceDelegation(text: string, requireHarness?: Harness): PointerCheck {
  let pointers: Pointer[];
  try {
    pointers = parsePointers(text);
  } catch (e) {
    return { note: "", ok: false, reason: (e as Error).message };
  }
  if (pointers.length !== 1) {
    return { note: pointers[0]?.note ?? "", ok: false, reason: `delegation needs exactly one handoff pointer, found ${pointers.length}` };
  }
  return checkPointers(text, requireHarness)[0]!;
}

// --- benchmark ----------------------------------------------------------

export interface BenchmarkOptions {
  note: string;
  runDir: string;
  append?: string;
  rubric?: string;
  harness: Harness;
  model: string;
  /** explicit native compression. default false: the benchmark writes authored bytes with no child. */
  compress?: boolean;
  executor?: CompressOptions["executor"];
  recipientExecutor?: CompressOptions["recipientExecutor"];
  /** test seam: replace the tokenizer. */
  tokenize?: (text: string) => Promise<{ count: number; tokenizer: string }>;
}

/** split a markdown spec into exact and prose blocks for a production run. */
export function specToDelta(source: string): HandoffDelta {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let kind: BlockKind = "prose";
  let inFence = false;
  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer.join("\n");
    if (text.trim()) blocks.push({ kind, text });
    buffer = [];
  };
  for (const line of lines) {
    if (line.startsWith("```")) {
      flush();
      inFence = !inFence;
      kind = "exact";
      buffer.push(line);
      continue;
    }
    const exactLine = inFence || /^\s*([-*|#]|\d+\.)\s/.test(line) || line.startsWith("    ") || line.includes("`");
    const nextKind: BlockKind = exactLine ? "exact" : "prose";
    if (nextKind !== kind) {
      flush();
      kind = nextKind;
    }
    buffer.push(line);
  }
  flush();
  return { blocks };
}

export interface RecipientEvidence {
  elapsed_ms: number;
  session_id: string | null;
  usage: unknown;
  text_sha256: string;
  input_sha256: string;
}

export interface StageComparison {
  input_bytes: number;
  baseline_bytes: number;
  output_bytes: number;
  input_tokens: number | null;
  baseline_tokens: number | null;
  output_tokens: number | null;
}

export interface RubricAnswer {
  id: number;
  question: string;
  expected: string;
  baseline_answer: string;
  output_answer: string;
  verdict: "unreviewed";
}

export interface NativeUsage {
  value: unknown;
  error: string | null;
}

export interface BenchmarkReport {
  rule_version: string;
  run_dir: string;
  artifacts: {
    source: string;
    source_sha256: string;
    create_baseline: string;
    create_baseline_sha256: string;
    create_output: string;
    create_output_sha256: string;
    append_source: string | null;
    append_source_sha256: string | null;
    append_baseline: string | null;
    append_baseline_sha256: string | null;
    final_baseline: string | null;
    final_baseline_sha256: string | null;
    final_output: string;
    final_output_sha256: string;
  };
  harness: string;
  model: string;
  /** true when the run requested native compression; false is a deterministic authored write. */
  compress: boolean;
  tokenizer: string;
  stages: { create: StageComparison; append: StageComparison | null; final: StageComparison | null };
  create_child: { elapsed_ms: number; usage: unknown; cost_usd: unknown; session_id: string | null };
  append_child: { elapsed_ms: number; usage: unknown; cost_usd: unknown; session_id: string | null } | null;
  native_usage: { create: NativeUsage | null; append: NativeUsage | null };
  recipient: { baseline: RecipientEvidence; output: RecipientEvidence };
  rubric: RubricAnswer[];
  generated_at: string;
}

async function countTokens(text: string): Promise<{ count: number; tokenizer: string }> {
  const mod = (await import("gpt-tokenizer/encoding/o200k_base")) as { encode?: (text: string) => number[] };
  if (typeof mod.encode !== "function") {
    throw new Error("gpt-tokenizer o200k_base encoding is unavailable");
  }
  return {
    count: mod.encode(text).length,
    tokenizer: "gpt-tokenizer o200k_base (proxy; not the gpt-6-astra tokenizer)",
  };
}

export function parseRubric(text: string): { id: number; question: string; expected: string }[] {
  const questions: { id: number; question: string; expected: string }[] = [];
  let current: { question: string; expected: string } | undefined;
  const flush = () => {
    if (current) questions.push({ id: questions.length + 1, question: current.question, expected: current.expected });
    current = undefined;
  };
  for (const line of text.split("\n")) {
    const q = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (q) {
      flush();
      const body = q[2]!;
      const same = body.match(/^(.*?)\s+expected:\s*(.*)$/i);
      if (same) {
        questions.push({ id: Number(q[1]), question: same[1]!.trim(), expected: same[2]!.trim().replace(/\.$/, "") });
      } else {
        current = { question: body.trim(), expected: "" };
      }
      continue;
    }
    const e = line.match(/^\s*expected:\s*(.*)$/i);
    if (e && current) {
      current.expected = e[1]!.trim().replace(/\.$/, "");
      flush();
    }
  }
  flush();
  return questions;
}

function recipientEvidence(child: ChildResult, inputDoc: string): RecipientEvidence {
  return {
    elapsed_ms: child.elapsedMs,
    session_id: child.sessionID ?? null,
    usage: child.usage,
    text_sha256: sha256(child.text),
    input_sha256: sha256(inputDoc),
  };
}

export async function runBenchmark(opts: BenchmarkOptions): Promise<BenchmarkReport> {
  requireHarnessModel({ harness: opts.harness, model: opts.model, executor: opts.executor });
  const source = readText(opts.note);
  if (!source.trim()) throw new Error(`benchmark note is empty: ${opts.note}`);
  if (opts.rubric && !existsSync(opts.rubric)) throw new Error(`rubric path does not exist: ${opts.rubric}`);
  if (existsSync(opts.runDir)) throw new Error(`benchmark run dir already exists; use a fresh path: ${opts.runDir}`);
  mkdirSync(opts.runDir, { recursive: true });

  const now = new Date().toISOString();
  const sourcePath = join(opts.runDir, "source.md");
  atomicWrite(sourcePath, source, 0o644);

  const createDelta = specToDelta(source);
  const createBaseline = renderDelta(createDelta, now, "create");
  const createBaselinePath = join(opts.runDir, "create-baseline.md");
  atomicWrite(createBaselinePath, createBaseline, 0o644);

  const finalPath = join(opts.runDir, "final-output.md");
  const writeOpts = { harness: opts.harness, model: opts.model, compress: opts.compress, executor: opts.executor };
  const createResult = createNote(finalPath, createDelta, writeOpts);
  const createOutput = createResult.built.block;
  const createOutputPath = join(opts.runDir, "create-output.md");
  atomicWrite(createOutputPath, createOutput, 0o644);

  let appendChild: ChildResult | null = null;
  let appendSource: string | null = null;
  let appendBaseline: string | null = null;
  let appendOutput = "";
  let appendBasePath: string | null = null;
  if (opts.append) {
    appendSource = readText(opts.append);
    if (!appendSource.trim()) throw new Error(`append source is empty: ${opts.append}`);
    const appendDelta = specToDelta(appendSource);
    appendBaseline = renderDelta(appendDelta, now, "append");
    atomicWrite(join(opts.runDir, "append-source.md"), appendSource, 0o644);
    appendBasePath = join(opts.runDir, "append-baseline.md");
    atomicWrite(appendBasePath, appendBaseline, 0o644);
    const appendResult = appendNote(finalPath, appendDelta, writeOpts);
    appendChild = appendResult.built.child;
    appendOutput = appendResult.built.block;
  }
  const finalOutput = readText(finalPath);
  const finalBaseline = appendBaseline !== null ? createBaseline + appendBaseline : null;
  const finalBaselinePath = finalBaseline !== null ? join(opts.runDir, "final-baseline.md") : null;
  if (finalBaseline !== null && finalBaselinePath) atomicWrite(finalBaselinePath, finalBaseline, 0o644);

  const tokenizer = (await (opts.tokenize ?? countTokens)(source)).tokenizer;
  const tokenCount = async (text: string): Promise<number> => (await (opts.tokenize ?? countTokens)(text)).count;

  const createStage: StageComparison = {
    input_bytes: Buffer.byteLength(source, "utf-8"),
    baseline_bytes: Buffer.byteLength(createBaseline, "utf-8"),
    output_bytes: Buffer.byteLength(createOutput, "utf-8"),
    input_tokens: await tokenCount(source),
    baseline_tokens: await tokenCount(createBaseline),
    output_tokens: await tokenCount(createOutput),
  };
  const appendStage: StageComparison | null =
    opts.append && appendSource !== null && appendBaseline !== null
      ? {
          input_bytes: Buffer.byteLength(appendSource, "utf-8"),
          baseline_bytes: Buffer.byteLength(appendBaseline, "utf-8"),
          output_bytes: Buffer.byteLength(appendOutput, "utf-8"),
          input_tokens: await tokenCount(appendSource),
          baseline_tokens: await tokenCount(appendBaseline),
          output_tokens: await tokenCount(appendOutput),
        }
      : null;
  const finalStage: StageComparison | null =
    opts.append && appendSource !== null && finalBaseline !== null
      ? {
          input_bytes: Buffer.byteLength(source, "utf-8") + Buffer.byteLength(appendSource, "utf-8"),
          baseline_bytes: Buffer.byteLength(finalBaseline, "utf-8"),
          output_bytes: Buffer.byteLength(finalOutput, "utf-8"),
          input_tokens: (await tokenCount(source)) + (await tokenCount(appendSource)),
          baseline_tokens: await tokenCount(finalBaseline),
          output_tokens: await tokenCount(finalOutput),
        }
      : null;

  const recipient = { baseline: blankEvidence(), output: blankEvidence() };
  const rubric: RubricAnswer[] = [];
  if (opts.rubric) {
    const questions = parseRubric(readText(opts.rubric));
    if (questions.length !== 15) throw new Error(`rubric must carry 15 questions, found ${questions.length}`);
    const recipientBaselineDoc = finalBaseline ?? createBaseline;
    const baseChild = runRecipient(recipientBaselineDoc, questions, opts);
    const outChild = runRecipient(finalOutput, questions, opts);
    recipient.baseline = recipientEvidence(baseChild, recipientBaselineDoc);
    recipient.output = recipientEvidence(outChild, finalOutput);
    const baseAnswers = parseRecipientAnswers(baseChild.text);
    const outAnswers = parseRecipientAnswers(outChild.text);
    for (const q of questions) {
      rubric.push({
        id: q.id,
        question: q.question,
        expected: q.expected,
        baseline_answer: baseAnswers.get(q.id) ?? "",
        output_answer: outAnswers.get(q.id) ?? "",
        verdict: "unreviewed",
      });
    }
  }

  const createSession = createResult.built.child?.sessionID ?? null;
  const appendSession = appendChild?.sessionID ?? null;
  const createExport =
    createSession && createResult.built.child?.usage == null ? exportSessionUsage(createSession) : null;
  const appendExport = appendSession && appendChild?.usage == null ? exportSessionUsage(appendSession) : null;

  const artifacts: BenchmarkReport["artifacts"] = {
    source: resolve(sourcePath),
    source_sha256: sha256(source),
    create_baseline: resolve(createBaselinePath),
    create_baseline_sha256: sha256(createBaseline),
    create_output: resolve(createOutputPath),
    create_output_sha256: sha256(createOutput),
    append_source: appendSource !== null ? resolve(join(opts.runDir, "append-source.md")) : null,
    append_source_sha256: appendSource !== null ? sha256(appendSource) : null,
    append_baseline: appendBasePath !== null ? resolve(appendBasePath) : null,
    append_baseline_sha256: appendBaseline !== null ? sha256(appendBaseline) : null,
    final_baseline: finalBaselinePath !== null ? resolve(finalBaselinePath) : null,
    final_baseline_sha256: finalBaseline !== null ? sha256(finalBaseline) : null,
    final_output: resolve(finalPath),
    final_output_sha256: sha256(finalOutput),
  };
  const verifyPaths: [string, string][] = [
    [sourcePath, artifacts.source_sha256],
    [createBaselinePath, artifacts.create_baseline_sha256],
    [createOutputPath, artifacts.create_output_sha256],
    [finalPath, artifacts.final_output_sha256],
  ];
  if (finalBaselinePath && artifacts.final_baseline_sha256) verifyPaths.push([finalBaselinePath, artifacts.final_baseline_sha256]);
  for (const [path, expected] of verifyPaths) {
    if (sha256(readFileSync(path)) !== expected) throw new Error(`artifact hash mismatch: ${path}`);
  }

  const report: BenchmarkReport = {
    rule_version: RULE_VERSION,
    run_dir: resolve(opts.runDir),
    artifacts,
    harness: createResult.receipt.harness,
    model: createResult.receipt.model,
    compress: opts.compress === true,
    tokenizer,
    stages: { create: createStage, append: appendStage, final: finalStage },
    create_child: {
      elapsed_ms: createResult.built.child?.elapsedMs ?? 0,
      usage: createResult.built.child?.usage ?? null,
      cost_usd: createResult.built.child?.costUsd ?? null,
      session_id: createSession,
    },
    append_child: appendChild
      ? { elapsed_ms: appendChild.elapsedMs, usage: appendChild.usage, cost_usd: appendChild.costUsd ?? null, session_id: appendSession }
      : null,
    native_usage: {
      create: createExport ? { value: createExport.usage, error: createExport.error } : null,
      append: appendExport ? { value: appendExport.usage, error: appendExport.error } : null,
    },
    recipient,
    rubric,
    generated_at: new Date().toISOString(),
  };
  atomicWrite(join(opts.runDir, "benchmark.json"), `${JSON.stringify(report, null, 2)}\n`, 0o644);
  atomicWrite(join(opts.runDir, "benchmark.md"), renderBenchmarkMarkdown(report), 0o644);
  return report;
}

function blankEvidence(): RecipientEvidence {
  return { elapsed_ms: 0, session_id: null, usage: null, text_sha256: "", input_sha256: "" };
}

function renderBenchmarkMarkdown(report: BenchmarkReport): string {
  const s = report.stages;
  const line = (name: string, stage: StageComparison) =>
    `- ${name}: bytes ${stage.input_bytes} -> baseline ${stage.baseline_bytes} -> output ${stage.output_bytes}; tokens ${stage.input_tokens}/${stage.baseline_tokens}/${stage.output_tokens}`;
  return [
    "# handoff compression benchmark",
    "",
    `- run dir: ${report.run_dir}`,
    `- harness: ${report.harness}`,
    `- model: ${report.model}`,
    `- mode: ${report.compress ? "explicit native compression" : "deterministic authored write (no child call)"}`,
    `- tokenizer: ${report.tokenizer}`,
    line("create", s.create),
    ...(s.append ? [line("append", s.append)] : []),
    ...(s.final ? [line("final", s.final)] : []),
    `- create child: ${report.create_child.elapsed_ms} ms, session ${report.create_child.session_id ?? "unknown"}`,
    `- append child: ${report.append_child ? `${report.append_child.elapsed_ms} ms` : "none"}`,
    `- recipient baseline: ${report.recipient.baseline.elapsed_ms} ms`,
    `- recipient output: ${report.recipient.output.elapsed_ms} ms`,
    `- rubric verdicts: unreviewed (${report.rubric.length} raw answers)`,
    "- this measures artifact size change only. it does not establish a workflow cost saving.",
    "",
  ].join("\n");
}

// --- cli ----------------------------------------------------------------

interface Args {
  command: string;
  note?: string;
  delta?: string;
  harness?: Harness;
  model?: string;
  expectRevision?: number;
  runDir?: string;
  append?: string;
  rubric?: string;
  compress: boolean;
  json: boolean;
}

export function parseHandoffArgs(argv: string[]): Args {
  const out: Args = { command: "verify", compress: false, json: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--delta") out.delta = argv[++i];
    else if (arg === "--harness") out.harness = argv[++i] as Harness;
    else if (arg === "--model") out.model = argv[++i];
    else if (arg === "--expect-revision") out.expectRevision = Number(argv[++i]);
    else if (arg === "--run-dir") out.runDir = argv[++i];
    else if (arg === "--append") out.append = argv[++i];
    else if (arg === "--rubric") out.rubric = argv[++i];
    else if (arg === "--compress") out.compress = true;
    else if (arg === "--json") out.json = true;
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (positional[0]) out.command = positional[0];
  if (positional[1]) out.note = positional[1];
  return out;
}

function requireArgs(args: Args): { harness: Harness; model: string } {
  if (!args.harness || !HARNESSES.includes(args.harness)) {
    throw new Error(`--harness must be one of ${HARNESSES.join(", ")}`);
  }
  if (!args.model) throw new Error("--model is required");
  return { harness: args.harness, model: args.model };
}

export async function handoffMain(argv: string[]): Promise<number> {
  const args = parseHandoffArgs(argv);
  if (args.command === "create" || args.command === "append") {
    if (!args.note) throw new Error(`${args.command} requires a note path`);
    if (!args.delta) throw new Error(`${args.command} requires --delta <json file>`);
    const { harness, model } = requireArgs(args);
    const delta = parseDelta(readText(args.delta));
    const opts = { harness, model, compress: args.compress };
    const result =
      args.command === "create" ? createNote(args.note, delta, opts) : appendNote(args.note, delta, { ...opts, expectRevision: args.expectRevision });
    process.stdout.write(`${JSON.stringify(result.receipt, null, 2)}\n`);
    return 0;
  }
  if (args.command === "verify") {
    if (!args.note) throw new Error("verify requires a note path");
    const verdict = verifyReceipt(args.note, args.harness ? { requireHarness: args.harness } : {});
    if (verdict.ok) {
      process.stdout.write(`ok revision ${verdict.receipt!.revision} harness ${verdict.receipt!.harness} ${resolve(args.note)}\n`);
      return 0;
    }
    process.stderr.write(`stale: ${verdict.reason}\n`);
    return 3;
  }
  if (args.command === "verify-delegation") {
    const text = readFileSync(0, "utf-8");
    const verdict = enforceDelegation(text, args.harness);
    if (verdict.ok) return 0;
    process.stderr.write(`${verdict.reason ?? "delegation rejected"}\n`);
    return 2;
  }
  if (args.command === "benchmark") {
    if (!args.note) throw new Error("benchmark requires a note path");
    if (!args.runDir) throw new Error("benchmark requires --run-dir");
    const { harness, model } = requireArgs(args);
    const report = await runBenchmark({
      note: args.note,
      runDir: args.runDir,
      append: args.append,
      rubric: args.rubric,
      harness,
      model,
      compress: args.compress,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  throw new Error(`unknown command: ${args.command}`);
}

if (import.meta.main) {
  handoffMain(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exit(1);
    });
}
