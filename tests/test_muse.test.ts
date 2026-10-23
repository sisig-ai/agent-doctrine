import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { generatedMuseAgentsMd } from "../src/generators.ts";

const REPO = join(import.meta.dir, "..");

describe("muse generated doctrine", () => {
  test("agents file has the marker, three rows, and muse paths", () => {
    const [target, rule] = generatedMuseAgentsMd();
    expect(target).toBe(join(REPO, "muse", "AGENTS.md"));
    expect(rule).toContain("<!-- GENERATED-MUSE-AGENTS: source=CLAUDE.md+hosts/muse.md+delegation.toml -->");
    expect(rule).toContain("| simplifier | muse-wonder-1.0 | muse-subagent |");
    expect(rule).toContain("| adv_review | muse-wonder-1.0 | muse-subagent |");
    expect(rule).toContain("| implementer | muse-spark-1.3 | muse-subagent |");
    expect(rule).toContain("runtime: muse-subagent");
    expect(rule).toContain("~/.config/muse/TENETS.md");
    expect(rule).not.toContain("~/.claude/TENETS.md");
    const table = rule.slice(rule.indexOf("<!-- DELEGATION:BEGIN -->"), rule.indexOf("<!-- DELEGATION:END -->"));
    const rows = table.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Role") && !line.startsWith("| ---"));
    expect(rows).toHaveLength(4);
    expect(table).not.toContain("implementer_light");
    expect(readFileSync(target, "utf-8")).toBe(rule);
  });
});
