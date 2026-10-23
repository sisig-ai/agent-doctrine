import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { codexFrozenHeader, generatedClaudeDoctrine, generatedCursorRule, generatedCodexAgentsMd, generatedOpencodeAgentsMd } from "../src/generators.ts";
import { installWrappers, readText, stripLocalBlock, REPO_ONLY_PATHS } from "../src/lib.ts";

describe("generator fixtures", () => {
  test("amp is in the repo-only stage allowlist", () => {
    expect(REPO_ONLY_PATHS).toContain("amp");
  });

  test("claude doctrine includes only claude mechanics", () => {
    const doctrine = generatedClaudeDoctrine();
    expect(doctrine).toContain("runtime: claude-agent");
    expect(doctrine).toContain("| adv_review | claude-opus-5-5 | claude-agent |");
    expect(doctrine).not.toContain("codex-subagent");
    expect(doctrine).not.toContain("cursor-subagent");
    expect(doctrine).not.toContain("opencode-subagent");
    expect(doctrine).not.toContain("amp-task-subagent");
  });

  test("cursor doctrine matches fixture", () => {
    const [, rule] = generatedCursorRule();
    const fixture = readText(join(import.meta.dir, "fixtures/generators/doctrine.mdc"));
    expect(rule).toBe(fixture);
  });

  test("codex agents md matches fixture", () => {
    const [, output] = generatedCodexAgentsMd();
    const fixture = readText(join(import.meta.dir, "fixtures/generators/AGENTS.md"));
    expect(output).toBe(fixture);
  });

  test("opencode agents md matches fixture", () => {
    const [, output] = generatedOpencodeAgentsMd();
    const fixture = readText(join(import.meta.dir, "fixtures/generators/opencode-AGENTS.md"));
    expect(output).toBe(fixture);
  });

  test("host generation is idempotent", () => {
    expect(generatedClaudeDoctrine()).toBe(generatedClaudeDoctrine());
    expect(generatedCursorRule()[1]).toBe(generatedCursorRule()[1]);
    expect(generatedCodexAgentsMd()[1]).toBe(generatedCodexAgentsMd()[1]);
    expect(generatedOpencodeAgentsMd()[1]).toBe(generatedOpencodeAgentsMd()[1]);
  });

  test("codex frozen header migrates the legacy sentinel", () => {
    const sentinel = "This file is synced from the shared `claude-md` doctrine repo. It is the Codex-native entrypoint; do not replace it with a pointer to `~/.claude/CLAUDE.md`.";
    expect(codexFrozenHeader(`# header\n\n${sentinel}\n\nold generated body\n`)).toBe(`# header\n\n${sentinel}`);
  });

  test("codex frozen header rejects duplicate boundaries", () => {
    const marker = "<!-- CODEX-FROZEN-HEADER:END -->";
    expect(() => codexFrozenHeader(`# header\n${marker}\nbody\n${marker}\n`)).toThrow(/found 2/);
  });

  test("generated host doctrine does not leak other host mechanics", () => {
    const [, cursor] = generatedCursorRule();
    const [, codex] = generatedCodexAgentsMd();
    const [, opencode] = generatedOpencodeAgentsMd();
    expect(cursor).toContain("runtime: cursor-subagent");
    expect(cursor).not.toContain("claude-agent");
    expect(cursor).not.toContain("codex-subagent");
    expect(cursor).not.toContain("opencode-subagent");
    expect(cursor).not.toContain("amp-task-subagent");
    expect(codex).toContain("runtime: codex-subagent");
    expect(codex).not.toContain("claude-agent");
    expect(codex).not.toContain("cursor-subagent");
    expect(codex).not.toContain("opencode-subagent");
    expect(codex).not.toContain("amp-task-subagent");
    expect(opencode).toContain("runtime: opencode-subagent");
    expect(opencode).not.toContain("claude-agent");
    expect(opencode).not.toContain("codex-subagent");
    expect(opencode).not.toContain("cursor-subagent");
    expect(opencode).not.toContain("amp-task-subagent");
    expect(opencode).not.toContain("~/.claude");
    expect(opencode).not.toContain("~/.codex");
    expect(opencode).not.toContain("~/.cursor");
  });

  test("shared doctrine contains no host mechanics", () => {
    const shared = ["CLAUDE.md", "TASTE.md", "TENETS.md"]
      .map((file) => readText(join(import.meta.dir, "..", file)))
      .join("\n");
    for (const term of [
      "claude-agent",
      "codex-subagent",
      "cursor-subagent",
      "opencode-subagent",
      "amp-task-subagent",
      "mcp__semble",
      "codex exec",
      "cursor-cli",
      "~/.claude",
      "~/.codex",
      "~/.cursor",
      "~/.config/opencode",
    ]) {
      expect(shared.toLowerCase()).not.toContain(term);
    }
  });
});

describe("wrapper forwarding", () => {
  test("doctrine-sync wrapper preserves argv", () => {
    const root = mkdtempSync(join(tmpdir(), "wrap-"));
    const home = join(root, "home");
    const repo = join(root, "repo");
    const capture = join(root, "argv");
    mkdirSync(home, { recursive: true });
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "sync.sh"), `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "$CAPTURE"\n`);
    chmodSync(join(repo, "sync.sh"), 0o755);
    const wrapper = join(home, ".local/bin/doctrine-sync");
    mkdirSync(join(wrapper, ".."), { recursive: true });
    writeFileSync(
      wrapper,
      `#!/usr/bin/env bash
set -euo pipefail
repo="${repo}"
cmd="\${1:-sync-all}"
if [[ "$cmd" == project-memory-* || "$cmd" == "project-memory" ]]; then shift || true
else cmd="sync-all"; fi
exec "$repo/sync.sh" "$cmd" "$@"
`,
    );
    chmodSync(wrapper, 0o755);
    const argv = ["project-memory", "path", "--json", "/checkout"];
    const r = spawnSync(wrapper, argv, { env: { ...process.env, CLAUDE_MD_DIR: repo, CAPTURE: capture } });
    expect(r.status).toBe(0);
    expect(readFileSync(capture, "utf-8").trim().split("\n")).toEqual(argv);
  });

  test("opencode-md-sync defaults to sync-opencode and forwards argv", () => {
    const root = mkdtempSync(join(tmpdir(), "wrap-opencode-"));
    const home = join(root, "home");
    const repo = join(root, "repo");
    const capture = join(root, "argv");
    mkdirSync(home, { recursive: true });
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "sync.sh"), `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "$CAPTURE"\n`);
    chmodSync(join(repo, "sync.sh"), 0o755);
    installWrappers(join(home, ".local", "bin"));
    const wrapper = join(home, ".local/bin/opencode-md-sync");
    expect(existsSync(wrapper)).toBe(true);
    const argv = ["pull", "--json"];
    const r = spawnSync(wrapper, argv, { env: { ...process.env, HOME: home, CLAUDE_MD_DIR: repo, CAPTURE: capture } });
    expect(r.status).toBe(0);
    expect(readFileSync(capture, "utf-8").trim().split("\n")).toEqual(["pull-opencode", "--json"]);
  });
});

describe("push-codex guard", () => {
  test("detects differing shared bodies", () => {
    const local = "# Role\ndifferent local body\n";
    const repo = "# Role\nrepo body\n";
    expect(stripLocalBlock(local, { allowLegacyCodex: true })).not.toBe(stripLocalBlock(repo, { allowLegacyCodex: true }));
  });

  test("allows matching shared bodies with local block", () => {
    const shared = "# Role\nshared body\n";
    const local =
      "<!-- LOCAL-ONLY:BEGIN - machine-specific; stripped before sync, never pushed. -->\nHARD RULE: local\n<!-- LOCAL-ONLY:END -->\n\n" +
      shared;
    expect(stripLocalBlock(local, { allowLegacyCodex: true })).toBe(shared);
  });
});
