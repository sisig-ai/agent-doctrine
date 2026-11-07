import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { spawnSync } from "child_process";

const root = resolve(import.meta.dir, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

const routers: Record<string, string[]> = {
  "CLAUDE.md": [
    "skills/communication-voice/SKILL.md",
    "skills/development-loop/SKILL.md",
    "skills/agent-handoffs/SKILL.md",
    "skills/doctrine-plan/references/shared-services.md",
    "skills/doctrine-plan/references/tenets-gate.md",
  ],
  "TENETS.md": ["skills/doctrine-plan/references/tenets-gate.md", "skills/development-loop/SKILL.md"],
  "TASTE.md": [
    "skills/communication-voice/SKILL.md",
    "skills/doctrine-plan/references/engineering.md",
    "skills/doctrine-ship/references/shipping.md",
  ],
  "HANDOFFS.md": [
    "skills/agent-handoffs/SKILL.md",
    "skills/agent-handoffs/references/handoff-formats.md",
    "skills/doctrine-plan/references/shared-services.md",
  ],
};

describe("public doctrine routing", () => {
  test("four routers link the new skills", () => {
    for (const [file, targets] of Object.entries(routers)) {
      const text = read(file);
      for (const target of targets) {
        expect(text).toContain(target);
        expect(existsSync(join(root, target))).toBe(true);
      }
    }
  });

  test("tenets-gate holds questions 1 through 15 and How these compose", () => {
    const gate = read("skills/doctrine-plan/references/tenets-gate.md");
    const numbers = [...gate.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(gate).toContain("## How these compose");
  });

  test("development-loop has eight steps and six stage skills", () => {
    const loop = read("skills/development-loop/SKILL.md");
    const steps = [...loop.matchAll(/^\d+\. \*\*/gm)];
    expect(steps.length).toBe(8);
    for (const stage of ["doctrine-scout", "doctrine-plan", "doctrine-implement", "doctrine-review", "doctrine-consolidate", "doctrine-ship"]) {
      expect(loop).toContain(stage);
    }
  });

  test("tracked tree has no cleverconsult path", () => {
    const listed = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
    expect(listed.status).toBe(0);
    expect(listed.stdout.toLowerCase()).not.toContain("cleverconsult");
  });
});
