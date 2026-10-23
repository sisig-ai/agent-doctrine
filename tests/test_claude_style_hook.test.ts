import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { ensureClaudeStyleHook, ensureCodexStyleHook } from "../src/host-hooks.ts";

function tempTarget(): string {
  return mkdtempSync(join(tmpdir(), "claude-style-hook-"));
}

describe("ensureClaudeStyleHook", () => {
  test("creates settings.json with the hook when absent", () => {
    const target = tempTarget();
    ensureClaudeStyleHook(target);
    const settings = JSON.parse(readFileSync(join(target, "settings.json"), "utf-8"));
    expect(settings.hooks.UserPromptSubmit).toEqual([
      { hooks: [{ type: "command", command: `cat '${join(target, "style-reminder.md")}'` }] },
    ]);
  });

  test("keeps other keys and other hook groups", () => {
    const target = tempTarget();
    const existing = {
      model: "opus",
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "echo pre" }] }],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo other" }] }],
      },
    };
    writeFileSync(join(target, "settings.json"), `${JSON.stringify(existing, null, 2)}\n`);
    ensureClaudeStyleHook(target);
    const settings = JSON.parse(readFileSync(join(target, "settings.json"), "utf-8"));
    expect(settings.model).toBe("opus");
    expect(settings.hooks.PreToolUse).toEqual(existing.hooks.PreToolUse);
    expect(settings.hooks.UserPromptSubmit.length).toBe(2);
    expect(settings.hooks.UserPromptSubmit[0]).toEqual(existing.hooks.UserPromptSubmit[0]);
    expect(settings.hooks.UserPromptSubmit[1].hooks[0].command).toBe(
      `cat '${join(target, "style-reminder.md")}'`,
    );
  });

  test("second run is a no-op", () => {
    const target = tempTarget();
    ensureClaudeStyleHook(target);
    const first = readFileSync(join(target, "settings.json"), "utf-8");
    ensureClaudeStyleHook(target);
    const second = readFileSync(join(target, "settings.json"), "utf-8");
    expect(second).toBe(first);
  });

  test("throws on invalid json", () => {
    const target = tempTarget();
    writeFileSync(join(target, "settings.json"), "{ not json");
    expect(() => ensureClaudeStyleHook(target)).toThrow();
    expect(existsSync(join(target, "settings.json"))).toBe(true);
  });

  test("shell-escapes a target path with an apostrophe", () => {
    const target = join(tempTarget(), "the user's");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    ensureClaudeStyleHook(target);
    const settings = JSON.parse(readFileSync(join(target, "settings.json"), "utf-8"));
    const command = settings.hooks.UserPromptSubmit[0].hooks[0].command;
    const run = spawnSync("sh", ["-c", command], { encoding: "utf-8" });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout).toBe("reminder body\n");
  });
});

describe("ensureCodexStyleHook", () => {
  test("writes hooks.json with the cat of style-reminder.md when absent", () => {
    const target = tempTarget();
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    ensureCodexStyleHook(target);
    expect(existsSync(join(target, "style-reminder.json"))).toBe(false);
    const hooks = JSON.parse(readFileSync(join(target, "hooks.json"), "utf-8"));
    expect(hooks.hooks.UserPromptSubmit).toEqual([
      { hooks: [{ type: "command", command: `cat '${join(target, "style-reminder.md")}'` }] },
    ]);
  });

  test("keeps other keys and other hook groups", () => {
    const target = tempTarget();
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    const existing = {
      model: "gpt",
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "echo pre" }] }],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo other" }] }],
      },
    };
    writeFileSync(join(target, "hooks.json"), `${JSON.stringify(existing, null, 2)}\n`);
    ensureCodexStyleHook(target);
    const hooks = JSON.parse(readFileSync(join(target, "hooks.json"), "utf-8"));
    expect(hooks.model).toBe("gpt");
    expect(hooks.hooks.PreToolUse).toEqual(existing.hooks.PreToolUse);
    expect(hooks.hooks.UserPromptSubmit.length).toBe(2);
    expect(hooks.hooks.UserPromptSubmit[0]).toEqual(existing.hooks.UserPromptSubmit[0]);
    expect(hooks.hooks.UserPromptSubmit[1].hooks[0].command).toBe(
      `cat '${join(target, "style-reminder.md")}'`,
    );
  });

  test("second run is a no-op", () => {
    const target = tempTarget();
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    ensureCodexStyleHook(target);
    const first = readFileSync(join(target, "hooks.json"), "utf-8");
    ensureCodexStyleHook(target);
    expect(readFileSync(join(target, "hooks.json"), "utf-8")).toBe(first);
  });

  test("throws on invalid hooks.json", () => {
    const target = tempTarget();
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    writeFileSync(join(target, "hooks.json"), "{ not json");
    expect(() => ensureCodexStyleHook(target)).toThrow();
  });

  test("shell-escapes a target path with an apostrophe", () => {
    const target = join(tempTarget(), "the user's");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "style-reminder.md"), "reminder body\n");
    ensureCodexStyleHook(target);
    const hooks = JSON.parse(readFileSync(join(target, "hooks.json"), "utf-8"));
    const command = hooks.hooks.UserPromptSubmit[0].hooks[0].command;
    const run = spawnSync("sh", ["-c", command], { encoding: "utf-8" });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout).toBe("reminder body\n");
  });
});
