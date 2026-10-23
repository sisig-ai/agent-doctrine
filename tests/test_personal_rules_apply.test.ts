import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

describe("applyMcp", () => {
  test("degrades to cli-only when mcp unavailable and sqlite open fails", () => {
    const root = mkdtempSync(join(tmpdir(), "pr-apply-"));
    const home = join(root, "home");
    const manifest = join(root, "manifest.json");
    const cliDir = join(root, "cli-rules");
    const dbDir = join(home, ".config", "Cursor", "User", "globalStorage");
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, "state.vscdb");
    writeFileSync(dbPath, "not-sqlite");
    chmodSync(dbPath, 0o000);
    writeFileSync(
      manifest,
      `${JSON.stringify({ version: 1, rules: [{ slug: "r1", content: "prefer terse replies" }] })}\n`,
    );
    const runner = join(root, "run.ts");
    const personalRules = join(import.meta.dir, "../src/personal-rules.ts");
    writeFileSync(
      runner,
      `import { applyMcp } from ${JSON.stringify(personalRules)};\nprocess.exit(applyMcp());\n`,
    );
    const result = spawnSync(process.execPath, [runner], {
      env: {
        ...process.env,
        HOME: home,
        PATH: "/usr/bin:/bin",
        CURSOR_PERSONAL_RULES_MANIFEST: manifest,
        CURSOR_CLI_RULES_DIR: cliDir,
      },
      encoding: "utf-8",
    });
    try {
      chmodSync(dbPath, 0o644);
    } catch {
      /* best effort cleanup */
    }
    expect(result.status).toBe(0);
    expect(existsSync(join(cliDir, "r1.mdc"))).toBe(true);
    expect(readFileSync(join(cliDir, "r1.mdc"), "utf-8")).toContain("prefer terse replies");
  });
});
