import { describe, expect, test, afterEach } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";
import {
  appendNote,
  buildDeltaBlock,
  compressText,
  createNote,
  enforceDelegation,
  HARNESSES,
  parseDelta,
  parsePointerLine,
  parsePointers,
  parseProseOutput,
  renderDelta,
  RULE_VERSION,
  specToDelta,
  validateReceipt,
  verifyReceipt,
  withLock,
} from "../scripts/handoff.ts";

const ORIGINAL_PATH = process.env.PATH;
afterEach(() => {
  process.env.PATH = ORIGINAL_PATH;
});

const PASSTHROUGH = (p: string): string => p;

function noteDir(): string {
  return mkdtempSync(join(tmpdir(), "handoff-note-"));
}

function fakeClaude(body: string, opts?: { exit?: number; sleepMs?: number }): void {
  const dir = mkdtempSync(join(tmpdir(), "handoff-fake-claude-"));
  const script = join(dir, "claude");
  const sleep = opts?.sleepMs ? `sleep ${(opts.sleepMs / 1000).toFixed(2)}\n` : "";
  writeFileSync(script, `#!/usr/bin/env bash\n${sleep}echo '${body.replace(/'/g, "'\\''")}'\nexit ${opts?.exit ?? 0}\n`);
  chmodSync(script, 0o755);
  process.env.PATH = `${dir}:${process.env.PATH}`;
}

function deltaFile(dir: string, delta: unknown): string {
  const path = join(dir, "delta.json");
  writeFileSync(path, JSON.stringify(delta));
  return path;
}

// existing compression tests explicitly select native compression.
const OPTS = { harness: "claude" as const, model: "test-model", executor: PASSTHROUGH, compress: true };

describe("delta schema", () => {
  test("rejects an unknown top-level key", () => {
    expect(() => parseDelta('{"blocks":[{"kind":"prose","text":"x"}],"extra":1}')).toThrow("unknown key");
  });

  test("rejects an unknown block key", () => {
    expect(() => parseDelta('{"blocks":[{"kind":"prose","text":"x","y":1}]}')).toThrow("unknown key");
  });

  test("rejects a bad kind", () => {
    expect(() => parseDelta('{"blocks":[{"kind":"other","text":"x"}]}')).toThrow('must be "exact" or "prose"');
  });

  test("rejects empty blocks", () => {
    expect(() => parseDelta('{"blocks":[]}')).toThrow("non-empty");
    expect(() => parseDelta('{"blocks":[{"kind":"prose","text":"  "}]}')).toThrow("no material");
  });

  test("accepts exact and prose blocks in order", () => {
    const delta = parseDelta('{"section":"log","blocks":[{"kind":"exact","text":"a"},{"kind":"prose","text":"b"}]}');
    expect(delta.blocks.map((b) => b.kind)).toEqual(["exact", "prose"]);
    expect(delta.section).toBe("log");
  });
});

describe("exact blocks", () => {
  test("preserve every byte, including whitespace, blank lines, and repetitions", () => {
    const exact = "  keep  trailing   spaces  \n\n\nstatus: fast\nstatus: fast\n";
    const built = buildDeltaBlock(
      { blocks: [{ kind: "exact", text: exact }, { kind: "prose", text: "compress me" }] },
      OPTS,
      "2026-10-08T00:00:00Z",
    );
    expect(built.block).toContain(exact);
    expect(built.child).not.toBeNull();
  });

  test("exact-only deltas skip the child", () => {
    const built = buildDeltaBlock({ blocks: [{ kind: "exact", text: "status: fast" }] }, OPTS, "");
    expect(built.child).toBeNull();
    expect(built.block).toContain("status: fast");
  });

  test("create preserves a leading newline in the first exact block", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    const exact = "\n\nleading blank lines\n";
    createNote(note, { blocks: [{ kind: "exact", text: exact }] }, OPTS);
    expect(readFileSync(note, "utf-8").startsWith(exact)).toBe(true);
  });

  test("append adds framing without touching existing bytes", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    createNote(note, { blocks: [{ kind: "exact", text: "first" }] }, OPTS);
    const before = readFileSync(note);
    appendNote(note, { blocks: [{ kind: "exact", text: "second" }] }, OPTS);
    expect(readFileSync(note).subarray(0, before.length).equals(before)).toBe(true);
  });

  test("a supplied section renders as a markdown heading on create and append", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    createNote(note, { section: "log", blocks: [{ kind: "exact", text: "body" }] }, OPTS);
    expect(readFileSync(note, "utf-8")).toContain("### log ");
    appendNote(note, { section: "log2", blocks: [{ kind: "exact", text: "more" }] }, OPTS);
    expect(readFileSync(note, "utf-8")).toContain("### log2 ");
  });
});

describe("prose compression", () => {
  test("renders prose and exact blocks in original order", () => {
    const built = buildDeltaBlock(
      {
        blocks: [
          { kind: "exact", text: "EXACT-1" },
          { kind: "prose", text: "PROSE-1" },
          { kind: "exact", text: "EXACT-2" },
        ],
      },
      { ...OPTS, executor: (p) => p },
      "",
    );
    expect(built.block.indexOf("EXACT-1")).toBeLessThan(built.block.indexOf("PROSE-1"));
    expect(built.block.indexOf("PROSE-1")).toBeLessThan(built.block.indexOf("EXACT-2"));
  });

  test("parseProseOutput rejects a missing block", () => {
    expect(() => parseProseOutput("@@HANDOFF_PROSE 0@@\na\n@@HANDOFF_END 0@@", 2)).toThrow("expected 2");
  });

  test("parseProseOutput rejects a mismatched marker", () => {
    expect(() => parseProseOutput("@@HANDOFF_PROSE 0@@\na\n@@HANDOFF_END 1@@", 1)).toThrow("mismatched");
  });

  test("parseProseOutput rejects text outside a block", () => {
    expect(() => parseProseOutput("stray\n@@HANDOFF_PROSE 0@@\na\n@@HANDOFF_END 0@@", 1)).toThrow("outside");
  });

  test("parseProseOutput rejects an empty block", () => {
    expect(() => parseProseOutput("@@HANDOFF_PROSE 0@@\n\n@@HANDOFF_END 0@@", 1)).toThrow("empty");
  });

  test("parseProseOutput rejects a reordered marker", () => {
    expect(() => parseProseOutput("@@HANDOFF_PROSE 1@@\na\n@@HANDOFF_END 1@@", 1)).toThrow("out of order");
  });

  test("parseProseOutput rejects a duplicate marker", () => {
    const dup = "@@HANDOFF_PROSE 0@@\na\n@@HANDOFF_END 0@@\n@@HANDOFF_PROSE 0@@\nb\n@@HANDOFF_END 0@@";
    expect(() => parseProseOutput(dup, 2)).toThrow("out of order");
  });
});

describe("harness and model are mandatory", () => {
  test("create rejects an unknown harness", () => {
    const dir = noteDir();
    expect(() =>
      createNote(join(dir, "n.md"), { blocks: [{ kind: "prose", text: "x" }] }, { harness: "identity" as never, model: "m", executor: PASSTHROUGH }),
    ).toThrow("harness must be one of");
  });

  test("create rejects a missing model", () => {
    const dir = noteDir();
    expect(() =>
      createNote(join(dir, "n.md"), { blocks: [{ kind: "prose", text: "x" }] }, { harness: "claude", model: "", executor: PASSTHROUGH }),
    ).toThrow("model is required");
  });

  test("HARNESSES has no identity entry", () => {
    expect(HARNESSES).toEqual(["claude", "opencode"]);
  });
});

describe("compressText error handling", () => {
  test("rejects non-json output", () => {
    fakeClaude("not json");
    expect(() => compressText("x", { harness: "claude", model: "m", timeoutMs: 5000 })).toThrow("non-json");
  });

  test("rejects an empty result", () => {
    fakeClaude(JSON.stringify({ result: "", usage: null }));
    expect(() => compressText("x", { harness: "claude", model: "m", timeoutMs: 5000 })).toThrow("empty");
  });

  test("rejects a non-zero exit", () => {
    fakeClaude(JSON.stringify({ result: "ok" }), { exit: 1 });
    expect(() => compressText("x", { harness: "claude", model: "m", timeoutMs: 5000 })).toThrow("exited 1");
  });

  test("rejects a timeout", () => {
    fakeClaude(JSON.stringify({ result: "late" }), { sleepMs: 800 });
    expect(() => compressText("x", { harness: "claude", model: "m", timeoutMs: 200 })).toThrow(/timed out/);
  });

  test("claude argv carries --safe-mode and an isolated setting source", () => {
    const { compressionArgv } = require("../scripts/handoff.ts") as typeof import("../scripts/handoff.ts");
    const argv = compressionArgv("claude", "m", "prompt");
    expect(argv).toContain("--safe-mode");
    expect(argv).toContain("--setting-sources");
  });
});

describe("receipts", () => {
  test("create writes a receipt bound to the absolute note", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    const result = createNote(note, { blocks: [{ kind: "exact", text: "status: fast" }] }, OPTS);
    expect(result.receipt.revision).toBe(1);
    expect(result.receipt.note).toBe(note);
    expect(result.receipt.rule_version).toBe(RULE_VERSION);
    expect(result.receipt.harness).toBe("claude");
    expect(result.receipt.model).toBe("test-model");
    expect(result.receipt.processing).toBe("authored");
    expect(verifyReceipt(note).ok).toBe(true);
  });

  test("validates absolute path, rule version, revision, harness, and model", () => {
    const receipt = {
      rule_version: RULE_VERSION,
      note: "/tmp/a.md",
      revision: 1,
      note_sha256: "0".repeat(64),
      harness: "claude",
      model: "m",
      processing: "authored",
    };
    expect(validateReceipt({ ...receipt }, "/tmp/a.md").ok).toBe(true);
    expect(validateReceipt({ ...receipt, note: "/tmp/b.md" }, "/tmp/a.md").ok).toBe(false);
    expect(validateReceipt({ ...receipt, rule_version: "old" }, "/tmp/a.md").ok).toBe(false);
    expect(validateReceipt({ ...receipt, revision: 0 }, "/tmp/a.md").ok).toBe(false);
    expect(validateReceipt({ ...receipt, harness: "nope" }, "/tmp/a.md").ok).toBe(false);
    expect(validateReceipt({ ...receipt, model: "" }, "/tmp/a.md").ok).toBe(false);
    expect(validateReceipt({ ...receipt }, "/tmp/a.md", "opencode").ok).toBe(false);
    expect(validateReceipt({ ...receipt, harness: "opencode" }, "/tmp/a.md", "opencode").ok).toBe(true);
  });

  test("rejects a missing or malformed processing field", () => {
    const receipt = {
      rule_version: RULE_VERSION,
      note: "/tmp/a.md",
      revision: 1,
      note_sha256: "0".repeat(64),
      harness: "claude",
      model: "m",
      processing: "authored",
    };
    expect(validateReceipt({ ...receipt, processing: undefined as never }, "/tmp/a.md").ok).toBe(false);
    expect(validateReceipt({ ...receipt, processing: "other" as never }, "/tmp/a.md").ok).toBe(false);
    expect(validateReceipt({ ...receipt, processing: "native-compressed" }, "/tmp/a.md").ok).toBe(true);
  });

  test("verify fails when the note is missing", () => {
    expect(verifyReceipt(join(noteDir(), "absent.md")).ok).toBe(false);
  });

  test("verify fails when the note changed after the receipt", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    createNote(note, { blocks: [{ kind: "exact", text: "a" }] }, OPTS);
    writeFileSync(note, `${readFileSync(note, "utf-8")}\nmanual\n`);
    expect(verifyReceipt(note).reason).toContain("stale");
  });

  test("verify rejects a receipt and content copied to another filename", () => {
    const dir = noteDir();
    const noteA = join(dir, "a.md");
    const noteB = join(dir, "b.md");
    createNote(noteA, { blocks: [{ kind: "exact", text: "same" }] }, OPTS);
    writeFileSync(noteB, readFileSync(noteA, "utf-8"));
    writeFileSync(`${noteB}.receipt.json`, readFileSync(`${noteA}.receipt.json`, "utf-8"));
    const verdict = verifyReceipt(noteB);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("bound to");
  });
});

describe("append", () => {
  test("keeps existing bytes byte-exact and bumps the revision", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    createNote(note, { blocks: [{ kind: "exact", text: "status: draft" }, { kind: "prose", text: "first" }] }, OPTS);
    const before = readFileSync(note);
    appendNote(note, { blocks: [{ kind: "exact", text: "## log" }] }, OPTS);
    expect(readFileSync(note).subarray(0, before.length).equals(before)).toBe(true);
    expect(verifyReceipt(note).receipt!.revision).toBe(2);
  });

  test("rejects a stale expect-revision", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    createNote(note, { blocks: [{ kind: "exact", text: "a" }] }, OPTS);
    appendNote(note, { blocks: [{ kind: "exact", text: "b" }] }, OPTS);
    expect(() => appendNote(note, { blocks: [{ kind: "exact", text: "c" }] }, { ...OPTS, expectRevision: 1 })).toThrow("expected revision 1");
  });

  test("rejects a manual edit between writes", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    createNote(note, { blocks: [{ kind: "exact", text: "a" }] }, OPTS);
    writeFileSync(note, `${readFileSync(note, "utf-8")}sneaky\n`);
    expect(() => appendNote(note, { blocks: [{ kind: "exact", text: "b" }] }, OPTS)).toThrow("changed since last receipt");
  });

  test("append requires an existing receipt", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    writeFileSync(note, "orphan\n");
    expect(() => appendNote(note, { blocks: [{ kind: "exact", text: "b" }] }, OPTS)).toThrow("no receipt");
  });
});

describe("concurrent append", () => {
  test("two processes serialize without losing an update", async () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    createNote(note, { blocks: [{ kind: "exact", text: "base" }] }, OPTS);
    const worker = join(import.meta.dir, "fixtures", "append-worker.ts");
    const run = (tag: string) =>
      new Promise<number>((res) => {
        const child = spawn("bun", [worker, note, tag], { stdio: "inherit" });
        child.on("exit", (code) => res(code ?? 1));
      });
    const [a, b] = await Promise.all([run("A"), run("B")]);
    expect(a).toBe(0);
    expect(b).toBe(0);
    const text = readFileSync(note, "utf-8");
    expect(text).toContain("worker A");
    expect(text).toContain("worker B");
    expect(verifyReceipt(note).receipt!.revision).toBe(3);
  });
});

describe("lock", () => {
  test("times out when held", () => {
    const dir = noteDir();
    const lock = join(dir, "x.lock");
    writeFileSync(lock, "");
    expect(() => withLock(lock, () => 1, 100)).toThrow("lock timeout");
  });
});

describe("delegation pointer", () => {
  test("parses a json pointer and keeps spaces", () => {
    const pointer = parsePointerLine('handoff: {"note":"/tmp/a b/c.md"}');
    expect(pointer).toEqual({ note: "/tmp/a b/c.md" });
  });

  test("rejects a relative path", () => {
    expect(() => parsePointerLine('handoff: {"note":"a.md"}')).toThrow("absolute");
  });

  test("rejects malformed json", () => {
    expect(() => parsePointerLine('handoff: {not json}')).toThrow("not valid json");
  });

  test("parsePointers reads one pointer per line", () => {
    expect(parsePointers('handoff: {"note":"/a.md"}\nother\nhandoff: {"note":"/b.md"}').map((p) => p.note)).toEqual(["/a.md", "/b.md"]);
  });

  test("enforceDelegation requires exactly one pointer", () => {
    expect(enforceDelegation("plain task").ok).toBe(false);
    expect(enforceDelegation('handoff: {"note":"/a.md"}\nhandoff: {"note":"/b.md"}').reason).toContain("exactly one");
  });

  test("enforceDelegation accepts one valid pointer and rejects a stale one", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    createNote(note, { blocks: [{ kind: "exact", text: "a" }] }, OPTS);
    expect(enforceDelegation(`do work\nhandoff: {"note":"${note}"}`).ok).toBe(true);
    writeFileSync(note, "tampered\n");
    expect(enforceDelegation(`do work\nhandoff: {"note":"${note}"}`).ok).toBe(false);
  });
});

describe("specToDelta", () => {
  test("marks code fences and list lines exact, prose elsewhere", () => {
    const delta = specToDelta("intro prose\n\n```\ncode\n```\n\n- list item\nmore prose\n");
    const kinds = delta.blocks.map((b) => b.kind);
    expect(kinds).toContain("exact");
    expect(kinds).toContain("prose");
    expect(delta.blocks.filter((b) => b.kind === "exact").map((b) => b.text).join("\n")).toContain("code");
  });
});

describe("authored default writes", () => {
  const THROWING = () => {
    throw new Error("child must not run for a default write");
  };
  const AUTHORED = { harness: "claude" as const, model: "test-model", executor: THROWING };

  test("create persists authored bytes with no child and records authored mode", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    const prose = "prose line with  two  spaces\nand a trailing space  \n\n";
    const exact = "  status: fast  \n\n";
    const delta = { blocks: [{ kind: "prose" as const, text: prose }, { kind: "exact" as const, text: exact }] };
    const result = createNote(note, delta, AUTHORED);
    expect(result.built.child).toBeNull();
    expect(result.receipt.processing).toBe("authored");
    expect(result.built.block).toBe(renderDelta(delta, "", "create"));
    const text = readFileSync(note, "utf-8");
    expect(text).toContain(prose);
    expect(text).toContain(exact);
  });

  test("append preserves existing bytes and records authored mode", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    createNote(note, { blocks: [{ kind: "exact", text: "first" }] }, AUTHORED);
    const before = readFileSync(note);
    const delta = { blocks: [{ kind: "prose" as const, text: "second prose\n" }] };
    const result = appendNote(note, delta, AUTHORED);
    expect(result.built.block).toBe(renderDelta(delta, "", "append"));
    const after = readFileSync(note);
    expect(after.subarray(0, before.length).equals(before)).toBe(true);
    expect(result.receipt.processing).toBe("authored");
    expect(verifyReceipt(note).receipt!.revision).toBe(2);
  });

  test("explicit compression records native-compressed", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    const result = createNote(note, { blocks: [{ kind: "prose", text: "compress me" }] }, OPTS);
    expect(result.built.child).not.toBeNull();
    expect(result.receipt.processing).toBe("native-compressed");
  });

  test("an exact-only explicit request records authored and skips the child", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    const result = createNote(note, { blocks: [{ kind: "exact", text: "status: fast" }] }, OPTS);
    expect(result.built.child).toBeNull();
    expect(result.receipt.processing).toBe("authored");
  });

  test("a compression failure leaves no note and no receipt", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    expect(() =>
      createNote(note, { blocks: [{ kind: "prose", text: "x" }] }, { harness: "claude", model: "m", compress: true, executor: THROWING }),
    ).toThrow("child must not run");
    expect(existsSync(note)).toBe(false);
    expect(existsSync(`${note}.receipt.json`)).toBe(false);
  });

  test("a compression failure on append leaves the note unchanged", () => {
    const dir = noteDir();
    const note = join(dir, "note.md");
    createNote(note, { blocks: [{ kind: "exact", text: "first" }] }, AUTHORED);
    const before = readFileSync(note);
    expect(() =>
      appendNote(note, { blocks: [{ kind: "prose", text: "x" }] }, { harness: "claude", model: "m", compress: true, executor: THROWING }),
    ).toThrow("child must not run");
    expect(readFileSync(note).equals(before)).toBe(true);
    expect(verifyReceipt(note).receipt!.processing).toBe("authored");
  });
});
