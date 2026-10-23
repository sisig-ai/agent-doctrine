import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { setupStyleReminder } from "../amp/plugins/style-reminder/setup.ts";

function reminderFile(text: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "amp-style-reminder-")), "style-reminder.md");
  writeFileSync(path, text);
  return path;
}

function ampHarness() {
  const handlers = new Map<string, () => unknown>();
  const amp = {
    on: (name: string, callback: () => unknown) => {
      handlers.set(name, callback);
    },
  };
  return { amp, handlers };
}

describe("style-reminder amp plugin", () => {
  test("registers agent.start and returns a hidden message with the file text", () => {
    const { amp, handlers } = ampHarness();
    setupStyleReminder(reminderFile("reminder body\n"))(amp);
    const callback = handlers.get("agent.start");
    expect(callback).toBeDefined();
    expect(callback!()).toEqual({ message: { content: "reminder body", display: false } });
  });

  test("throws at setup when the file is missing", () => {
    const path = join(mkdtempSync(join(tmpdir(), "amp-style-reminder-")), "absent.md");
    expect(() => setupStyleReminder(path)).toThrow();
  });

  test("throws at setup when the file is empty", () => {
    expect(() => setupStyleReminder(reminderFile("  \n"))).toThrow("is empty");
  });

  test("independent plugin instances register their own handler", () => {
    const first = ampHarness();
    const second = ampHarness();
    setupStyleReminder(reminderFile("first\n"))(first.amp);
    setupStyleReminder(reminderFile("second\n"))(second.amp);
    expect(first.handlers.get("agent.start")!()).toEqual({ message: { content: "first", display: false } });
    expect(second.handlers.get("agent.start")!()).toEqual({ message: { content: "second", display: false } });
  });
});
