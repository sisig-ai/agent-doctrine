import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const amp = readFileSync(join(root, "AMP.md"), "utf8");

describe("Amp code-search host rules", () => {
  test("requires direct Semble invocation rather than MCP discovery", () => {
    expect(amp).toContain("`semble_search` and `semble_find_related` are direct amp plugin tools");
    expect(amp).toContain("`tool_search` searches connected MCP servers only");
    expect(amp).toContain("only an error from directly invoking the relevant semble tool establishes semble failure");
  });

  test("preserves finder and exact-search boundaries and halts on direct failure", () => {
    expect(amp).toContain("use amp `finder` for multi-step searches that must correlate distinct code areas");
    expect(amp).toContain("use exact search for literal strings, symbols, exhaustive caller lists, or test assertions");
    expect(amp).toContain("if a direct semble invocation errors, report the blocker and halt");
    expect(amp).toContain("do not silently replace it with grep or finder");
  });

  test("keeps Amp search mechanics out of shared doctrine", () => {
    for (const file of ["CLAUDE.md", "TASTE.md", "TENETS.md"]) {
      const body = readFileSync(join(root, file), "utf8");
      expect(body).not.toMatch(/tool_search|semble_search|semble_find_related/);
    }
  });
});
