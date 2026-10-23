import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import { join, relative } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

function files(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...files(path));
    else if (entry.isFile()) out.push(path);
  }
  return out.sort();
}

function digest(root: string): string {
  const hash = createHash("sha256");
  for (const path of files(root)) {
    hash.update(relative(root, path));
    hash.update(readFileSync(path));
  }
  return hash.digest("hex");
}

function makeReadOnly(root: string): void {
  for (const path of files(root)) chmodSync(path, statSync(path).mode & 0o111 ? 0o555 : 0o444);
  const dirs = [root];
  for (let index = 0; index < dirs.length; index++) {
    const dir = dirs[index]!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(join(dir, entry.name));
    }
  }
  for (const dir of dirs.reverse()) chmodSync(dir, 0o555);
}

describe("apply-snapshot", () => {
  test("applies a read-only tree without git or network access", () => {
    const root = mkdtempSync(join(tmpdir(), "snapshot-apply-"));
    const source = join(root, "source");
    const home = join(root, "home");
    const blocked = join(root, "blocked-bin");
    mkdirSync(home, { recursive: true });
    mkdirSync(blocked, { recursive: true });
    cpSync(join(import.meta.dir, ".."), source, {
      recursive: true,
      filter: (path) => !path.includes(`${join(import.meta.dir, "..", ".git")}`),
    });
    for (const command of ["git", "curl"]) {
      const path = join(blocked, command);
      writeFileSync(path, "#!/usr/bin/env bash\necho network command called >&2\nexit 90\n");
      chmodSync(path, 0o755);
    }
    // apply-snapshot runs `bun install` for repo-managed opencode plugins. Stub it
    // so this test stays hermetic and never reaches the network.
    const bunStub = join(blocked, "bun");
    writeFileSync(bunStub, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(bunStub, 0o755);
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "LOCAL.md"), "# local test\n");
    const modeCases = [
      { name: "mode-0444.txt", source: 0o444, target: 0o644 },
      { name: "mode-0555.txt", source: 0o555, target: 0o755 },
      { name: "mode-0400.txt", source: 0o400, target: 0o600 },
    ];
    for (const modeCase of modeCases) {
      writeFileSync(join(source, "claude", "skills", modeCase.name), `${modeCase.name}\n`);
    }
    const before = digest(source);
    makeReadOnly(source);
    for (const modeCase of modeCases) {
      chmodSync(join(source, "claude", "skills", modeCase.name), modeCase.source);
    }
    const targetSkills = join(home, ".claude", "skills");
    mkdirSync(targetSkills, { recursive: true });
    for (const modeCase of modeCases) {
      const target = join(targetSkills, modeCase.name);
      writeFileSync(target, "stale prior image content\n");
      chmodSync(target, modeCase.source);
    }

    const env = {
      ...process.env,
      HOME: home,
      PATH: `${blocked}:${process.env.PATH}`,
      CLAUDE_MD_DIR: source,
      CLAUDE_MD_SNAPSHOT: "1",
      CLAUDE_MD_TARGET: join(home, ".claude"),
      CODEX_MD_TARGET: join(home, ".codex"),
      CURSOR_MD_TARGET: join(home, ".cursor"),
      OPENCODE_MD_TARGET: join(home, ".config", "opencode"),
      AMP_MD_TARGET: join(home, ".config", "amp"),
      CURSOR_CLI_RULES_DIR: join(home, ".cursor", "rules", "doctrine-synced"),
    };
    const applyOnce = () =>
      spawnSync(process.execPath, [join(source, "src", "cli.ts"), "apply-snapshot"], {
        env,
        encoding: "utf-8",
      });
    const apply = applyOnce();
    expect(apply.status, `${apply.stdout}\n${apply.stderr}`).toBe(0);
    const reapply = applyOnce();
    expect(reapply.status, `${reapply.stdout}\n${reapply.stderr}`).toBe(0);
    expect(digest(source)).toBe(before);
    for (const modeCase of modeCases) {
      expect(statSync(join(source, "claude", "skills", modeCase.name)).mode & 0o777).toBe(modeCase.source);
      expect(statSync(join(home, ".claude", "skills", modeCase.name)).mode & 0o777).toBe(modeCase.target);
      expect(readFileSync(join(home, ".claude", "skills", modeCase.name), "utf-8")).toBe(`${modeCase.name}\n`);
    }
    expect(readFileSync(join(home, ".claude", "CLAUDE.md"), "utf-8")).toContain("# Role");
    expect(readFileSync(join(home, ".codex", "AGENTS.md"), "utf-8")).toContain("# Codex Global Instructions");
    expect(existsSync(join(home, ".cursor", "rules", "doctrine.mdc"))).toBe(true);
    expect(existsSync(join(home, ".config", "opencode", "AGENTS.md"))).toBe(true);

    const claudeSettings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf-8"));
    expect(claudeSettings.hooks.UserPromptSubmit[0].hooks[0].command).toContain("style-reminder.md");
    const codexHooks = JSON.parse(readFileSync(join(home, ".codex", "hooks.json"), "utf-8"));
    expect(codexHooks.hooks.UserPromptSubmit[0].hooks[0].command).toContain("style-reminder.md");
    const cursorHooks = JSON.parse(readFileSync(join(home, ".cursor", "hooks.json"), "utf-8"));
    for (const event of ["sessionStart", "postToolUse", "postToolUseFailure"]) {
      expect(cursorHooks.hooks[event][0].command).toContain("style-reminder.json");
    }
    expect(existsSync(join(home, ".config", "amp", "style-reminder.md"))).toBe(true);
    expect(existsSync(join(home, ".config", "amp", "plugins", "style-reminder", "index.ts"))).toBe(true);

    const hookFiles = [
      join(home, ".claude", "settings.json"),
      join(home, ".codex", "hooks.json"),
      join(home, ".cursor", "hooks.json"),
    ];
    const afterFirst = hookFiles.map((path) => readFileSync(path, "utf-8"));
    const reapplyAgain = applyOnce();
    expect(reapplyAgain.status, `${reapplyAgain.stdout}\n${reapplyAgain.stderr}`).toBe(0);
    hookFiles.forEach((path, index) => {
      expect(readFileSync(path, "utf-8")).toBe(afterFirst[index]);
    });
    for (const path of [
      join(home, ".codex", "LOCAL.md"),
      join(home, ".cursor", "LOCAL.md"),
      join(home, ".config", "opencode", "LOCAL.md"),
    ]) {
      expect(lstatSync(path).isSymbolicLink()).toBe(true);
    }

    const wrapper = join(home, ".local", "bin", "doctrine-sync");
    expect(statSync(wrapper).mode & 0o111).not.toBe(0);
    // process.execPath can be a shim named bun.exe; link it as `bun` so the wrapper resolves the real binary.
    const realBin = join(root, "real-bin");
    mkdirSync(realBin, { recursive: true });
    symlinkSync(process.execPath, join(realBin, "bun"));
    const status = spawnSync("bash", ["-lc", `env -i HOME='${home}' PATH='${join(home, ".local", "bin")}:${realBin}:${blocked}:/usr/bin:/bin' doctrine-sync status`], {
      encoding: "utf-8",
    });
    expect(status.status, `${status.stdout}\n${status.stderr}`).toBe(0);
    expect(status.stdout).toContain("snapshot:       read-only");
    expect(status.stderr).not.toContain("network command called");
  }, 120_000);
});
