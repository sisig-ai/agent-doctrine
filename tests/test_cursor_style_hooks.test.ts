import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { ensureCursorStyleHooks } from "../src/host-hooks.ts";

function tempTarget(): string {
  return mkdtempSync(join(tmpdir(), "cursor-style-hooks-"));
}

const EVENTS = ["sessionStart", "postToolUse", "postToolUseFailure"];

describe("ensureCursorStyleHooks", () => {
  test("creates version 1 hooks.json with all three events and the json output", () => {
    const target = tempTarget();
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    ensureCursorStyleHooks(target);
    const output = JSON.parse(readFileSync(join(target, "style-reminder.json"), "utf-8"));
    expect(output).toEqual({ additional_context: "reminder body" });
    const file = JSON.parse(readFileSync(join(target, "hooks.json"), "utf-8"));
    expect(file.version).toBe(1);
    for (const event of EVENTS) {
      expect(file.hooks[event]).toEqual([{ command: `cat '${join(target, "style-reminder.json")}'` }]);
    }
  });

  test("preserves other keys and other hook groups", () => {
    const target = tempTarget();
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    const existing = {
      version: 1,
      model: "auto",
      hooks: {
        sessionStart: [{ command: "echo existing" }],
        stop: [{ command: "echo stop" }],
      },
    };
    writeFileSync(join(target, "hooks.json"), `${JSON.stringify(existing, null, 2)}\n`);
    ensureCursorStyleHooks(target);
    const file = JSON.parse(readFileSync(join(target, "hooks.json"), "utf-8"));
    expect(file.model).toBe("auto");
    expect(file.hooks.stop).toEqual(existing.hooks.stop);
    expect(file.hooks.sessionStart.length).toBe(2);
    expect(file.hooks.sessionStart[0]).toEqual({ command: "echo existing" });
  });

  test("the stored command prints valid json", () => {
    const target = tempTarget();
    writeFileSync(join(target, "style-reminder.md"), 'quote " backtick ` done\n');
    ensureCursorStyleHooks(target);
    const file = JSON.parse(readFileSync(join(target, "hooks.json"), "utf-8"));
    const command = file.hooks.postToolUse[0].command;
    const run = spawnSync("sh", ["-c", command], { encoding: "utf-8" });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(JSON.parse(run.stdout).additional_context).toBe('quote " backtick ` done');
  });

  test("shell-escapes a target path with an apostrophe", () => {
    const target = join(tempTarget(), "the user's");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    ensureCursorStyleHooks(target);
    const file = JSON.parse(readFileSync(join(target, "hooks.json"), "utf-8"));
    const run = spawnSync("sh", ["-c", file.hooks.sessionStart[0].command], { encoding: "utf-8" });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(JSON.parse(run.stdout).additional_context).toBe("reminder body");
  });

  test("second run is a no-op", () => {
    const target = tempTarget();
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    ensureCursorStyleHooks(target);
    const first = readFileSync(join(target, "hooks.json"), "utf-8");
    ensureCursorStyleHooks(target);
    expect(readFileSync(join(target, "hooks.json"), "utf-8")).toBe(first);
  });

  test("persists version 1 when all three commands already exist", () => {
    const target = tempTarget();
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    const command = `cat '${join(target, "style-reminder.json")}'`;
    const existing = {
      hooks: {
        sessionStart: [{ command }],
        postToolUse: [{ command }],
        postToolUseFailure: [{ command }],
      },
    };
    writeFileSync(join(target, "hooks.json"), `${JSON.stringify(existing, null, 2)}\n`);
    ensureCursorStyleHooks(target);
    const file = JSON.parse(readFileSync(join(target, "hooks.json"), "utf-8"));
    expect(file.version).toBe(1);
    for (const event of EVENTS) expect(file.hooks[event].length).toBe(1);
  });

  test("throws when the reminder markdown is missing", () => {
    const target = tempTarget();
    expect(() => ensureCursorStyleHooks(target)).toThrow();
  });

  test("throws on invalid json", () => {
    const target = tempTarget();
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    writeFileSync(join(target, "hooks.json"), "{ not json");
    expect(() => ensureCursorStyleHooks(target)).toThrow();
  });

  test("rejects an unsupported version", () => {
    const target = tempTarget();
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    writeFileSync(join(target, "hooks.json"), `${JSON.stringify({ version: 2, hooks: {} })}\n`);
    expect(() => ensureCursorStyleHooks(target)).toThrow("unsupported version 2");
  });

  test("rejects a malformed hooks object", () => {
    const target = tempTarget();
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    writeFileSync(join(target, "hooks.json"), `${JSON.stringify({ version: 1, hooks: [] })}\n`);
    expect(() => ensureCursorStyleHooks(target)).toThrow("malformed hooks object");
  });

  test("rejects a malformed event list", () => {
    const target = tempTarget();
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    writeFileSync(join(target, "hooks.json"), `${JSON.stringify({ version: 1, hooks: { sessionStart: {} } })}\n`);
    expect(() => ensureCursorStyleHooks(target)).toThrow("malformed sessionStart list");
  });

  test("writes style-reminder.json only when the reminder exists", () => {
    const target = tempTarget();
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    ensureCursorStyleHooks(target);
    expect(existsSync(join(target, "style-reminder.json"))).toBe(true);
  });
});
