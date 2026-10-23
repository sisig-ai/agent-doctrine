import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { generatedOpencodeAgentsMd, opencodeRoleAgent } from "../src/generators.ts";
import { loadDelegation } from "../src/delegation.ts";
import { composeWithLocalBlock, parseFrontmatter, readText, stripLocalBlock, writeText } from "../src/lib.ts";
import { desiredServers, mergeOpencodeMcp, wire } from "../scripts/wire-opencode-mcp.ts";

const REPO = join(import.meta.dir, "..");
const DELEGATION = loadDelegation(join(REPO, "delegation.toml"));

describe("opencode generated doctrine", () => {
  test("generates from shared doctrine with native paths only", () => {
    const [target, output] = generatedOpencodeAgentsMd();
    expect(target).toBe(join(REPO, "opencode", "AGENTS.md"));
    expect(output).toContain("GENERATED-OPENCODE-AGENTS");
    expect(output).toContain("opencode-subagent");
    expect(output).not.toContain("~/.claude");
    expect(output).not.toContain("claude-agent");
    expect(output).not.toContain("codex-subagent");
    expect(output).not.toContain("cursor-subagent");
  });

  test("installs the registered project-memory contract", () => {
    const output = generatedOpencodeAgentsMd()[1];
    expect(output).toContain("doctrine-sync project-memory path");
    expect(output).toContain("doctrine-sync project-memory path --json");
    expect(output).toContain("rg -i -m 10");
    expect(output).toContain("$MEMORY_ROOT/MEMORY.md");
    expect(output).toContain("never read `conflicts/`");
    expect(output).toContain('"native_memory"');
    expect(output).toContain("agent_note_<slug>.md");
    expect(output).toContain("`shared:` roots match the exact registered directory only");
    expect(output).not.toContain("~/.cursor");
  });
});

describe("opencode native subagents", () => {
  const all = ["adv-review", "ai-engineer", "implementer", "principal-engineer", "scout", "simplifier"];
  const readOnly = ["simplifier", "ai-engineer", "principal-engineer", "adv-review", "scout"];

  test("all present", () => {
    for (const name of all) {
      expect(existsSync(join(REPO, "opencode", "agents", `${name}.md`))).toBe(true);
    }
  });

  test("all agents are mode subagent", () => {
    for (const name of all) {
      const text = readText(join(REPO, "opencode", "agents", `${name}.md`));
      expect(text).toContain("mode: subagent");
      expect(text).not.toContain("model: opus");
    }
  });

  test("every role agent carries the exact delegation model", () => {
    for (const [file, role] of [
      ["simplifier", "simplifier"],
      ["adv-review", "adv_review"],
      ["implementer", "implementer"],
    ] as const) {
      const { meta } = parseFrontmatter(readText(join(REPO, "opencode", "agents", `${file}.md`)));
      const model = DELEGATION.opencode[role].model;
      expect(meta.model).toBe(model === "default" ? undefined : model);
    }
  });

  test("role-agent sources carry no model and rendering injects it from delegation", () => {
    for (const source of ["adv-review", "implementer"]) {
      const src = readText(join(REPO, "opencode", "agents-src", `${source}.md`));
      expect(src).not.toContain("model:");
    }
    const data = structuredClone(DELEGATION);
    data.opencode.adv_review.model = "sentinel/model#x";
    data.opencode.implementer.model = "sentinel/model#y";
    expect(opencodeRoleAgent("adv_review", data)[1]).toContain("model: sentinel/model#x");
    expect(opencodeRoleAgent("implementer", data)[1]).toContain("model: sentinel/model#y");
  });

  test("scout agent has no model line while its binding is default", () => {
    const text = opencodeRoleAgent("scout")[1];
    expect(text).toContain("mode: subagent");
    expect(text).not.toContain("model:");
    const data = structuredClone(DELEGATION);
    data.opencode.scout.model = "sentinel/model#z";
    expect(opencodeRoleAgent("scout", data)[1]).toContain("model: sentinel/model#z");
  });

  test("review agents are read-only, implementer is not", () => {
    for (const name of readOnly) {
      const text = readText(join(REPO, "opencode", "agents", `${name}.md`));
      expect(text).toContain("mode: subagent");
      expect(text).toMatch(/permissions:\n(?:  .*\n)*  - action: edit\n    resource: "\*"\n    effect: deny/);
    }
    const implementer = readText(join(REPO, "opencode", "agents", "implementer.md"));
    expect(implementer).not.toContain("action: edit");
  });

  test("openCode subagents do not reference other host runtimes", () => {
    for (const name of all) {
      const text = readText(join(REPO, "opencode", "agents", `${name}.md`));
      expect(text).not.toContain("claude-agent");
      expect(text).not.toContain("codex-subagent");
      expect(text).not.toContain("cursor-subagent");
      expect(text).not.toContain("mcp__semble");
    }
  });
});

describe("opencode native skills", () => {
  test("ships humanizer and manage-claude-md", () => {
    for (const id of ["humanizer", "manage-claude-md"]) {
      expect(existsSync(join(REPO, "opencode", "skills", id, "SKILL.md"))).toBe(true);
    }
  });

  test("doctrine-review is a shared skill and the overlay names the opencode runtime", () => {
    expect(existsSync(join(REPO, "opencode", "skills", "adv-review"))).toBe(false);
    expect(existsSync(join(REPO, "skills", "doctrine-review", "SKILL.md"))).toBe(true);
    const overlay = readText(join(REPO, "hosts", "opencode.md"));
    expect(overlay).toContain("load the `doctrine-review` skill");
    expect(overlay).toContain("runtime: opencode-subagent");
  });
});

describe("setup-new-machine command and skill", () => {
  const commandPath = join(REPO, "opencode", "commands", "setup-new-machine.md");
  const skillDir = join(REPO, "opencode", "skills", "setup-new-machine");
  const skillPath = join(skillDir, "SKILL.md");
  const scriptPath = join(skillDir, "scripts", "setup-new-machine.sh");

  test("ships the command, skill, and executable script", () => {
    expect(existsSync(commandPath)).toBe(true);
    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync(scriptPath)).toBe(true);
    expect(statSync(scriptPath).mode & 0o111).not.toBe(0);
  });

  test("command passes $ARGUMENTS and requires the name prompt", () => {
    const text = readText(commandPath);
    expect(text).toContain("$ARGUMENTS");
    expect(text).toContain("setup-new-machine` skill");
    expect(text.toLowerCase()).toContain("ask me what to call");
  });

  test("skill makes the name prompt mandatory", () => {
    const { meta, body } = parseFrontmatter(readText(skillPath));
    expect(meta.name).toBe("setup-new-machine");
    expect(meta.description).toContain("workstation");
    expect(body).toContain("mandatory first step");
    expect(body).toContain("do not run a command");
  });

  test("script passes bash -n", () => {
    const result = spawnSync("bash", ["-n", scriptPath], { encoding: "utf-8" });
    expect(result.status, result.stderr).toBe(0);
  });

  test("--dry-run plans every remote action with the resolved dir and never echoes secrets", () => {
    const result = spawnSync("bash", [scriptPath, "bogus@invalid-host", "--name", "test-workstation", "--dry-run"], {
      encoding: "utf-8",
      env: {
        ...process.env,
        CLAUDE_MD_DIR: REPO,
        TAILSCALE_AUTH_KEY: "sentinel-tailscale",
        OPENCODE_SERVER_PASSWORD: "sentinel-password",
        GHCR_TOKEN: "sentinel-ghcr",
      },
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain("tailscale_auth_key");
    expect(output).toContain("test-workstation");
    expect(output).toContain("printf %s \"$HOME\"");
    expect(output).toContain("docker version >/dev/null 2>&1");
    expect(output).toContain("docker compose version >/dev/null 2>&1");
    expect(output).toContain("docker manifest inspect");
    expect(output).toContain("docker login ghcr.io");
    expect(output).toContain("$HOME/workspaces/test-workstation");
    expect(output).toContain("tar -C <staging> -cf - . | ssh bogus@invalid-host 'mkdir -p $HOME/workspaces/test-workstation && tar -C $HOME/workspaces/test-workstation -xf -'");
    expect(output).toContain("docker compose pull -q && docker compose up -d");
    expect(output).toContain("State.Health.Status");
    expect(output.trimEnd().endsWith("no vm action and no secret staged.")).toBe(true);
    expect(output).not.toContain("sentinel-tailscale");
    expect(output).not.toContain("sentinel-password");
    expect(output).not.toContain("sentinel-ghcr");

    const custom = spawnSync(
      "bash",
      [scriptPath, "bogus@invalid-host", "--name", "test-workstation", "--dir", "/srv/agent work", "--dry-run"],
      { encoding: "utf-8", env: { ...process.env, CLAUDE_MD_DIR: REPO } },
    );
    expect(custom.status, `${custom.stdout}\n${custom.stderr}`).toBe(0);
    const customOutput = `${custom.stdout}\n${custom.stderr}`;
    // the shown dir must equal the real qdir rule, `printf %q` of the raw --dir.
    const qDir = spawnSync("bash", ["-c", 'printf %q "$1"', "bash", "/srv/agent work"], { encoding: "utf-8" }).stdout;
    expect(qDir).toBe("/srv/agent\\ work");
    expect(customOutput).toContain(`remote dir:  ${qDir}`);
    expect(customOutput).toContain(`mkdir -p ${qDir} && tar -C ${qDir} -xf -`);
    expect(customOutput).toContain(`cd ${qDir} && docker compose pull -q && docker compose up -d`);
    expect(customOutput).toContain(`cd ${qDir} && docker inspect`);
    expect(customOutput).not.toContain("$HOME/workspaces");
  });

  test("dotenv writer escapes backslash, quote, and dollar and round-trips", () => {
    const script = readText(scriptPath);
    const start = script.indexOf("env_line() {");
    const end = script.indexOf("\n}\n", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fn = script.slice(start, end + 3);

    const runEnvLine = (value: string) =>
      spawnSync(
        "bash",
        ["-c", `${fn}\ndie() { echo "die: $*" >&2; exit 1; }\nenv_line OPENCODE_SERVER_PASSWORD "$1"`, "bash", value],
        { encoding: "utf-8" },
      );

    const value = 's3cret $HOME "x" \\ end';
    const written = runEnvLine(value);
    expect(written.status, written.stderr).toBe(0);
    expect(written.stdout).toBe('OPENCODE_SERVER_PASSWORD="s3cret \\$HOME \\"x\\" \\\\ end"\n');
    const inner = written.stdout.slice(written.stdout.indexOf('"') + 1, written.stdout.lastIndexOf('"'));
    expect(inner.replace(/\\([\\"$])/g, "$1")).toBe(value);

    const rejected = runEnvLine("line1\nline2");
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("newline");
  });

  test("rejects invalid --name, --image, and GHCR_USER before touching the vm", () => {
    const run = (args: string[], extraEnv: Record<string, string> = {}) =>
      spawnSync("bash", [scriptPath, "bogus@invalid-host", "--dry-run", ...args], {
        encoding: "utf-8",
        env: { ...process.env, CLAUDE_MD_DIR: REPO, GHCR_USER: "", ...extraEnv },
      });

    const badName = run(["--name", "Bad_Name"]);
    expect(badName.status, badName.stderr).not.toBe(0);
    expect(badName.stderr).toContain("invalid --name");

    const longName = run(["--name", "a".repeat(64)]);
    expect(longName.status, longName.stderr).not.toBe(0);
    expect(longName.stderr).toContain("invalid --name");

    const badImage = run(["--name", "ok-name", "--image", "img;rm -rf /"]);
    expect(badImage.status, badImage.stderr).not.toBe(0);
    expect(badImage.stderr).toContain("invalid --image");

    const badUser = run(["--name", "ok-name"], { GHCR_USER: "bad user" });
    expect(badUser.status, badUser.stderr).not.toBe(0);
    expect(badUser.stderr).toContain("invalid GHCR_USER");
  });

  test("cli.ts deploys opencode/commands on both the snapshot and sync paths", () => {
    const cli = readText(join(REPO, "src", "host-sync.ts")) + readText(join(REPO, "src", "snapshot.ts"));
    const marker = 'join(REPO_DIR, "opencode", "commands"), join(OPENCODE_TARGET, "commands")';
    expect(cli.split(marker).length - 1).toBe(2);
  });
});

describe("opencode AGENTS.md local-only block", () => {
  test("preserves a machine-local block and strips it from the shared body", () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-agent-md-"));
    const repoFile = join(root, "AGENTS.md");
    const target = join(root, "target", "AGENTS.md");
    const generated = generatedOpencodeAgentsMd()[1];
    writeText(repoFile, generated);
    writeText(
      target,
      "<!-- LOCAL-ONLY:BEGIN - machine-specific; stripped before sync, never pushed. -->\nHARD RULE: local\n<!-- LOCAL-ONLY:END -->\n\n" + generated,
    );
    composeWithLocalBlock(target, repoFile);
    const composed = readText(target);
    expect(composed).toContain("HARD RULE: local");
    expect(stripLocalBlock(composed)).toBe(generated);
  });

  test("push guard detects a differing shared body", () => {
    const generated = generatedOpencodeAgentsMd()[1];
    expect(stripLocalBlock("# different shared body\n")).not.toBe(generated);
    expect(stripLocalBlock(generated)).toBe(generated);
  });
});

describe("opencode MCP JSONC merge", () => {
  test("adds managed servers, keeps comments and unrelated settings", () => {
    const source = `{
  // keep this comment
  "$schema": "https://opencode.ai/config.json",
  "model": "openai/gpt-5.6-sol#medium",
  "mcp": {
    "servers": {
      "existing": { "type": "remote", "url": "https://example.com/mcp" }
    }
  }
}
`;
    const servers = desiredServers({
      HONCHO_API_KEY: "super-secret-key",
      HONCHO_WORKSPACE: "example-workspace",
      PORCH_MCP_TOKEN: "porch-secret",
    } as NodeJS.ProcessEnv);
    const merged = mergeOpencodeMcp(source, servers);
    expect(merged).toContain("// keep this comment");
    expect(merged).toContain('"existing"');
    expect(merged).toContain('"model": "openai/gpt-5.6-sol#medium"');
    expect(merged).toContain('"semble"');
    expect(merged).toContain('"honcho"');
    expect(merged).toContain('"porch"');
    expect(merged).toContain("{env:HONCHO_API_KEY}");
    expect(merged).toContain("{env:PORCH_MCP_TOKEN}");
    expect(merged).not.toContain("super-secret-key");
    expect(merged).not.toContain("porch-secret");
  });

  test("omits honcho and porch when required env vars are absent", () => {
    const servers = desiredServers({} as NodeJS.ProcessEnv);
    expect(Object.keys(servers)).toEqual(["semble"]);
    const merged = mergeOpencodeMcp("{}", servers);
    expect(merged).not.toContain("honcho");
    expect(merged).not.toContain("porch");
  });

  test("omits honcho when only one required var is present", () => {
    const servers = desiredServers({ HONCHO_API_KEY: "k" } as NodeJS.ProcessEnv);
    expect(servers.honcho).toBeUndefined();
  });

  test("removes stale managed servers and preserves unrelated servers", () => {
    const source = `{
  // keep this comment
  "mcp": {
    "servers": {
      "honcho": { "type": "remote", "url": "https://mcp.honcho.dev" },
      "porch": { "type": "remote", "url": "https://porch.sh/mcp" },
      "keepme": { "type": "remote", "url": "https://keep.example/mcp" }
    }
  }
}
`;
    const env = {} as NodeJS.ProcessEnv;
    const merged = mergeOpencodeMcp(source, desiredServers(env));
    expect(merged).toContain("// keep this comment");
    expect(merged).toContain('"keepme"');
    expect(merged).toContain('"semble"');
    expect(merged).not.toContain('"honcho"');
    expect(merged).not.toContain('"porch"');
    // Idempotent: a second pass over the merged text changes nothing.
    expect(mergeOpencodeMcp(merged, desiredServers(env))).toBe(merged);
  });

  test("removes stale managed entries on wire and is idempotent", () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-mcp-stale-"));
    const target = join(root, "opencode.jsonc");
    writeFileSync(
      target,
      `{
  "mcp": {
    "servers": {
      "semble": { "type": "local", "command": ["semble"] },
      "honcho": { "type": "remote", "url": "https://mcp.honcho.dev" },
      "porch": { "type": "remote", "url": "https://porch.sh/mcp" },
      "keepme": { "type": "remote", "url": "https://keep.example/mcp" }
    }
  }
}
`,
    );
    wire({} as NodeJS.ProcessEnv, root);
    const first = readFileSync(target, "utf-8");
    expect(first).toContain('"keepme"');
    expect(first).not.toContain('"honcho"');
    expect(first).not.toContain('"porch"');
    wire({} as NodeJS.ProcessEnv, root);
    expect(readFileSync(target, "utf-8")).toBe(first);
  });

  test("fails on invalid JSONC and leaves the file unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-mcp-"));
    const target = join(root, "opencode.jsonc");
    const broken = `{ "mcp": { "servers": { `;
    writeFileSync(target, broken);
    expect(() => wire({} as NodeJS.ProcessEnv, root)).toThrow(/invalid JSONC/);
    expect(readFileSync(target, "utf-8")).toBe(broken);
  });

  test("wire creates the config with semble when absent", () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-mcp-new-"));
    const result = wire({} as NodeJS.ProcessEnv, root);
    expect(result.path).toBe(join(root, "opencode.jsonc"));
    const written = JSON.parse(readFileSync(result.path, "utf-8"));
    expect(written.mcp.servers.semble).toEqual({ type: "local", command: ["semble"] });
  });

  test("wire preserves an existing opencode.json", () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-mcp-json-"));
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "opencode.json"), `{ "username": "the user" }\n`);
    const result = wire({} as NodeJS.ProcessEnv, root);
    expect(result.path).toBe(join(root, "opencode.json"));
    const written = JSON.parse(readFileSync(result.path, "utf-8"));
    expect(written.username).toBe("the user");
    expect(written.mcp.servers.semble).toBeDefined();
  });
});
