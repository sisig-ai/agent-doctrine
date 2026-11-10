import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

const swarmLine =
  "The lead swarms: one self-verifying worker per seam. Trust, but verify analytically.";

describe("maximal swarm and self-validation", () => {
  test("plan splits at every seam and drops the cap", () => {
    const skill = read("skills/doctrine-plan/SKILL.md");
    expect(skill).toContain(
      "one split applies only when the task has no seam; the spec states why.",
    );
    expect(skill).toContain("split at every seam.");
    expect(skill).toContain(
      "a seam is a file-disjoint unit that one author can build, test, and prove alone against fixed shared interfaces.",
    );
    expect(skill).toContain("maximize the split count: one implementer per seam, with no cap.");
    expect(skill).toContain("target four or more splits.");
    expect(skill).toContain(
      "fewer than four needs a stated reason in the spec for each missing seam.",
    );
    expect(skill).not.toContain("at most 3");
    expect(skill).not.toContain("one split is fine");
  });

  test("implementers build, test, and prove each split", () => {
    const skill = read("skills/doctrine-implement/SKILL.md");
    expect(skill).toContain(
      "the lead's job is maximal swarming: every split runs at once, and each member builds and self-verifies its split.",
    );
    expect(skill).toContain(
      "each author writes or updates the tests for its change, runs them, and proves the split works.",
    );
    expect(skill).toContain("a passing test alone is not proof of behavior.");
    expect(skill).toContain(
      "the lead supervises and checks each proof. `adv_review` audits code, tests, test runs, and proof. trust, but verify analytically.",
    );
    expect(skill).toContain("missing tests or proof stops the split");
  });

  test("review audits tests and proof", () => {
    const skill = read("skills/doctrine-review/SKILL.md");
    expect(skill).toContain(
      "reviewers audit the tests: coverage of changed behavior and failure cases, the exact run, and its result.",
    );
    expect(skill).toContain(
      "reviewers audit the proof: real exercise of the written code path, mapped to each definition-of-done number, reproduced when cheap and safe.",
    );
    expect(skill).toContain(
      "unearned complexity, missing or weak tests, and missing or invalid proof block.",
    );
  });

  test("handoff templates carry seams, tests, and proof", () => {
    const text = read("skills/agent-handoffs/references/handoff-formats.md");
    expect(text).toContain(
      "the independent units that run concurrently, one per seam (rules in `doctrine-plan`).",
    );
    expect(text).not.toContain("a small change has one split");
    expect(text).toContain(
      "each split names its own tests and the proof its implementer must produce.",
    );
    expect(text).toContain("`tests:` (test files written, exact command, exact result)");
    expect(text).toContain(
      "`proof:` (one item per definition-of-done number: the artifact that exercises the written code path, plus what it does not prove)",
    );
    expect(text).toContain("missing or weak tests, missing or invalid proof.");
  });

  test("adv-review audits tests and may rerun them", () => {
    const agent = read("agents/adv-review.md");
    const needle =
      "for a diff round, audit the tests. check that they cover the changed behavior and its failure cases";
    expect(agent).toContain(needle);
    expect(agent).toContain(
      "audit the proof. check that each artifact exercises the real code path the split wrote, on real input, and maps to a definition-of-done number.",
    );
    expect(agent).toContain("missing or weak tests, or missing or invalid proof");
    expect(agent).toContain(
      "you may run the stated tests and read-only proof commands the implementer names.",
    );
    expect(agent).toContain("you never run other mutating commands.");
    for (const path of [
      "cursor/agents/adv-review.md",
      "cursor/skills/adv-review/SKILL.md",
      "codex/skills/adv-review/SKILL.md",
      "opencode/agents-src/adv-review.md",
      "opencode/agents/adv-review.md",
    ]) {
      expect(read(path)).toContain(needle);
    }
  });

  test("implementer agents write tests and prove the split", () => {
    const old =
      "implement the change, then run the focused tests the spec names. report the exact command and the exact result.";
    const writeTests =
      "implement the change. write or update the tests that cover it, run them, and report the exact command and the exact result.";
    for (const file of [
      "claude/agents/implementer.md",
      "claude/agents/implementer-light.md",
      "opencode/agents-src/implementer.md",
      "opencode/agents/implementer.md",
    ]) {
      const text = read(file);
      expect(text).not.toContain(old);
      expect(text).toContain(writeTests);
      expect(text).toContain("prove the split does what the spec says. exercise the real code path you wrote");
      expect(text).toContain("trust, but verify analytically");
      expect(text).toContain("`tests:`");
      expect(text).toContain("`proof:`");
    }
  });

  test("host doctrine carries the swarm line", () => {
    for (const file of [
      "CLAUDE.md",
      "codex/AGENTS.md",
      "cursor/rules/doctrine.mdc",
      "grok/rules/doctrine.md",
      "muse/AGENTS.md",
      "opencode/AGENTS.md",
      "tests/fixtures/generators/AGENTS.md",
      "tests/fixtures/generators/doctrine.mdc",
      "tests/fixtures/generators/opencode-AGENTS.md",
    ]) {
      expect(read(file)).toContain(swarmLine);
    }
  });
});
