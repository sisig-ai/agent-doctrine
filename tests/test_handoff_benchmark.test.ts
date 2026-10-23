import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runBenchmark, sha256 } from "../scripts/handoff.ts";

// no-op compression: the child returns the marked payload unchanged, so prose
// survives byte-for-byte and baseline and output must match.
const NOOP = (payload: string): string => payload;
const fakeTokenize = async (text: string) => ({ count: text.length, tokenizer: "test-length-counter" });

function benchDir(): string {
  return mkdtempSync(join(tmpdir(), "handoff-bench-"));
}

function writeRubric(dir: string): string {
  const lines: string[] = [];
  for (let i = 1; i <= 15; i++) lines.push(`${i}. question number ${i}? expected: answer number ${i}.`);
  const path = join(dir, "rubric.md");
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

const NOTE = "intro prose line here\n\n```\ncode block\n```\n\n- exact list item\n";
const APPEND = "appended prose line\n\n- appended exact item\n";

function base(dir: string) {
  const note = join(dir, "note.md");
  writeFileSync(note, NOTE);
  const append = join(dir, "append.md");
  writeFileSync(append, APPEND);
  return { note, append };
}

describe("benchmark determinism", () => {
  test("no-op compression gives equal baseline and output bytes", async () => {
    const dir = benchDir();
    const { note } = base(dir);
    const report = await runBenchmark({
      note,
      runDir: join(dir, "run"),
      harness: "claude",
      model: "m",
      compress: true,
      executor: NOOP,
      tokenize: fakeTokenize,
    });
    expect(report.stages.create.output_bytes).toBe(report.stages.create.baseline_bytes);
    expect(report.stages.create.output_tokens).toBe(report.stages.create.baseline_tokens);
    expect(report.tokenizer).toBe("test-length-counter");
  });

  test("wrong recipient answers stay unreviewed", async () => {
    const dir = benchDir();
    const { note } = base(dir);
    const rubric = writeRubric(dir);
    const report = await runBenchmark({
      note,
      runDir: join(dir, "run"),
      rubric,
      harness: "claude",
      model: "m",
      compress: true,
      executor: NOOP,
      recipientExecutor: () => "1|wrong answer\n2|also wrong",
      tokenize: fakeTokenize,
    });
    expect(report.rubric).toHaveLength(15);
    expect(report.rubric.every((q) => q.verdict === "unreviewed")).toBe(true);
    expect(report.rubric[0]!.baseline_answer).toBe("wrong answer");
    expect(report.rubric[0]!.output_answer).toBe("wrong answer");
  });

  test("a missing rubric path errors", async () => {
    const dir = benchDir();
    const { note } = base(dir);
    await expect(
      runBenchmark({
        note,
        runDir: join(dir, "run"),
        rubric: join(dir, "absent.md"),
        harness: "claude",
        model: "m",
        executor: NOOP,
        tokenize: fakeTokenize,
      }),
    ).rejects.toThrow("rubric path does not exist");
  });

  test("an existing run dir is refused", async () => {
    const dir = benchDir();
    const { note } = base(dir);
    const runDir = join(dir, "run");
    mkdirSync(runDir, { recursive: true });
    await expect(runBenchmark({ note, runDir, harness: "claude", model: "m", executor: NOOP, tokenize: fakeTokenize })).rejects.toThrow(
      "already exists",
    );
  });
});

describe("benchmark artifacts", () => {
  test("create-output excludes append bytes and hashes match", async () => {
    const dir = benchDir();
    const { note, append } = base(dir);
    const runDir = join(dir, "run");
    const report = await runBenchmark({
      note,
      runDir,
      append,
      harness: "claude",
      model: "m",
      compress: true,
      executor: NOOP,
      tokenize: fakeTokenize,
    });
    const createOutput = readFileSync(join(runDir, "create-output.md"), "utf-8");
    const finalOutput = readFileSync(join(runDir, "final-output.md"), "utf-8");
    expect(createOutput).not.toContain("appended exact item");
    expect(finalOutput).toContain("appended exact item");
    expect(sha256(readFileSync(join(runDir, "create-output.md")))).toBe(report.artifacts.create_output_sha256);
    expect(sha256(readFileSync(join(runDir, "final-output.md")))).toBe(report.artifacts.final_output_sha256);
    expect(existsSync(join(runDir, "create-baseline.md"))).toBe(true);
    expect(existsSync(join(runDir, "final-baseline.md"))).toBe(true);
  });

  test("append and final stages compare equal information", async () => {
    const dir = benchDir();
    const { note, append } = base(dir);
    const report = await runBenchmark({
      note,
      runDir: join(dir, "run"),
      append,
      harness: "claude",
      model: "m",
      compress: true,
      executor: NOOP,
      tokenize: fakeTokenize,
    });
    expect(report.stages.append).not.toBeNull();
    expect(report.stages.final).not.toBeNull();
    expect(report.stages.append!.output_bytes).toBe(report.stages.append!.baseline_bytes);
    expect(report.stages.final!.output_bytes).toBe(report.stages.final!.baseline_bytes);
    expect(report.stages.append!.input_bytes).toBe(Buffer.byteLength(APPEND, "utf-8"));
  });

  test("recipient baseline and output carry equal information", async () => {
    const dir = benchDir();
    const { note, append } = base(dir);
    const rubric = writeRubric(dir);
    const prompts: string[] = [];
    const report = await runBenchmark({
      note,
      runDir: join(dir, "run"),
      append,
      rubric,
      harness: "claude",
      model: "m",
      compress: true,
      executor: NOOP,
      recipientExecutor: (prompt) => {
        prompts.push(prompt);
        return "1|wrong";
      },
      tokenize: fakeTokenize,
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("appended exact item");
    expect(prompts[1]).toContain("appended exact item");
    const finalBaselineDoc = readFileSync(join(dir, "run", "final-baseline.md"), "utf-8");
    const finalOutputDoc = readFileSync(join(dir, "run", "final-output.md"), "utf-8");
    expect(report.recipient.baseline.input_sha256).toBe(sha256(finalBaselineDoc));
    expect(report.recipient.output.input_sha256).toBe(sha256(finalOutputDoc));
    expect(report.recipient.baseline.input_sha256).toBe(report.recipient.output.input_sha256);
  });
});

describe("authored default benchmark", () => {
  test("the default run makes no child call and writes authored bytes", async () => {
    const dir = benchDir();
    const { note, append } = base(dir);
    const runDir = join(dir, "run");
    const throwing = () => {
      throw new Error("benchmark must not call a child without --compress");
    };
    const report = await runBenchmark({
      note,
      runDir,
      append,
      harness: "claude",
      model: "m",
      executor: throwing,
      tokenize: fakeTokenize,
    });
    expect(report.compress).toBe(false);
    expect(report.create_child.elapsed_ms).toBe(0);
    expect(report.create_child.session_id).toBeNull();
    expect(readFileSync(join(runDir, "create-output.md"), "utf-8")).toBe(readFileSync(join(runDir, "create-baseline.md"), "utf-8"));
  });
});
