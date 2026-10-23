import { describe, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { loadDelegation } from "../src/delegation.ts";

const REPO = join(import.meta.dir, "..");
const SKILLS = ["doctrine-scout", "doctrine-plan", "doctrine-implement", "doctrine-review", "doctrine-consolidate", "doctrine-ship"];
const AGENTS: Record<string, string> = {
  simplifier: "agents/simplifier.md",
  adv_review: "agents/adv-review.md",
  implementer: "claude/agents/implementer.md",
  implementer_light: "claude/agents/implementer-light.md",
  scout: "agents/scout.md",
};

function frontmatter(path: string): Record<string, string> {
  const text = readFileSync(join(REPO, path), "utf-8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${path}: no frontmatter`);
  const out: Record<string, string> = {};
  let key = "";
  for (const line of match[1]!.split("\n")) {
    const kv = line.match(/^([a-z_-]+):\s*(.*)$/);
    if (kv) {
      key = kv[1]!;
      out[key] = kv[2]!.replace(/^>-?$/, "").trim();
    } else if (key) out[key] = `${out[key]} ${line.trim()}`.trim();
  }
  return out;
}

type SyncFn = "syncClaude" | "syncCodex" | "syncCursor" | "syncOpencode" | "syncGrok" | "syncMuse";

function pull(host: SyncFn, prepare?: (home: string) => void): string {
  const home = mkdtempSync(join(tmpdir(), "claude-agents-"));
  // opencode pull runs `bun install` for plugins; a stub keeps the test off the network.
  const stubs = join(home, "stub-bin");
  mkdirSync(stubs, { recursive: true });
  writeFileSync(join(stubs, "bun"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(stubs, "bun"), 0o755);
  prepare?.(home);
  // generators write into CLAUDE_MD_DIR, so pull from a copy to keep the repo clean.
  const repoCopy = join(home, "repo");
  cpSync(REPO, repoCopy, {
    recursive: true,
    filter: (src) => !/(^|\/)(\.git|node_modules)$/.test(src),
  });
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${stubs}:${process.env.PATH}`,
    CLAUDE_MD_DIR: repoCopy,
    CLAUDE_MD_TARGET: join(home, ".claude"),
    CODEX_MD_TARGET: join(home, ".codex"),
    CURSOR_MD_TARGET: join(home, ".cursor"),
    OPENCODE_MD_TARGET: join(home, ".config", "opencode"),
    GROK_MD_TARGET: join(home, ".grok"),
    MUSE_MD_TARGET: join(home, ".config", "muse"),
    AMP_MD_TARGET: join(home, ".config", "amp"),
  };
  const code = `import { ${host} } from ${JSON.stringify(join(REPO, "src", "host-sync.ts"))}; ${host}("pull");`;
  const run = spawnSync(process.execPath, ["-e", code], { env, encoding: "utf-8" });
  expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
  return home;
}

describe("claude agent files", () => {
  const data = loadDelegation(join(REPO, "delegation.toml"));
  for (const [role, path] of Object.entries(AGENTS)) {
    test(`${path} has name, description, and the delegation.toml model`, () => {
      const fm = frontmatter(path);
      expect(fm.name).toBeTruthy();
      expect(fm.description).toBeTruthy();
      expect(fm.model).toBe(data.claude[role]!.model);
    });
  }

  test("adv-review is the reviewer persona, not the lead playbook", () => {
    const text = readFileSync(join(REPO, "agents", "adv-review.md"), "utf-8");
    expect(text).not.toContain("you are the **lead**");
    expect(text).toContain("## round <n>: adv_review plan | adv_review diff");
  });
});

describe("shared skills reach host targets", () => {
  test("claude pull installs all 5 agents and all 6 skills", () => {
    const home = pull("syncClaude");
    for (const file of ["simplifier", "adv-review", "implementer", "implementer-light", "scout"]) {
      expect(existsSync(join(home, ".claude", "agents", `${file}.md`))).toBe(true);
    }
    for (const id of SKILLS) expect(existsSync(join(home, ".claude", "skills", id, "SKILL.md"))).toBe(true);
  });

  const HOSTS: [SyncFn, string[]][] = [
    ["syncCodex", [".codex", "skills"]],
    ["syncCursor", [".cursor", "skills"]],
    ["syncOpencode", [".config", "opencode", "skills"]],
    ["syncGrok", [".grok", "skills"]],
    ["syncMuse", [".config", "muse", "skills"]],
  ];
  for (const [fn, dir] of HOSTS) {
    test(`${fn} pull installs all 6 skills`, () => {
      const home = pull(fn);
      for (const id of SKILLS) expect(existsSync(join(home, ...dir, id, "SKILL.md"))).toBe(true);
    });
  }

  const SCOUT: [SyncFn, string[], { skill: string[]; marker: string } | null][] = [
    ["syncCodex", [".codex", "agents"], { skill: [".codex", "skills"], marker: "<!-- GENERATED-CODEX-AGENT: source=" }],
    ["syncCursor", [".cursor", "agents"], { skill: [".cursor", "skills"], marker: "<!-- GENERATED-CURSOR-AGENT-SKILL: source=" }],
    ["syncOpencode", [".config", "opencode", "agents"], null],
    ["syncGrok", [".grok", "agents"], null],
  ];
  for (const [fn, agentsDir, generated] of SCOUT) {
    test(`${fn} pull keeps the scout agent${generated ? " and its generated skill" : ""}`, () => {
      const home = pull(fn);
      expect(existsSync(join(home, ...agentsDir, "scout.md"))).toBe(true);
      if (generated) {
        const skill = readFileSync(join(home, ...generated.skill, "scout", "SKILL.md"), "utf-8");
        expect(skill).toContain(generated.marker);
      }
    });
  }

  test("codex pull keeps the generated adv-review skill next to doctrine-review", () => {
    const home = pull("syncCodex");
    expect(existsSync(join(home, ".codex", "skills", "adv-review", "SKILL.md"))).toBe(true);
  });

  test("opencode pull removes the obsolete adv-review skill dir and keeps other skills", () => {
    const home = pull("syncOpencode", (h) => {
      const skills = join(h, ".config", "opencode", "skills");
      mkdirSync(join(skills, "adv-review"), { recursive: true });
      writeFileSync(join(skills, "adv-review", "SKILL.md"), "stale\n");
      mkdirSync(join(skills, "machine-local"), { recursive: true });
      writeFileSync(join(skills, "machine-local", "SKILL.md"), "keep\n");
    });
    const skills = join(home, ".config", "opencode", "skills");
    expect(existsSync(join(skills, "adv-review"))).toBe(false);
    expect(existsSync(join(skills, "machine-local", "SKILL.md"))).toBe(true);
    expect(existsSync(join(skills, "doctrine-review", "SKILL.md"))).toBe(true);
  });

  test("skills are host-neutral", () => {
    for (const id of SKILLS) {
      expect(readFileSync(join(REPO, "skills", id, "SKILL.md"), "utf-8")).not.toContain("~/.claude");
    }
  });
});
