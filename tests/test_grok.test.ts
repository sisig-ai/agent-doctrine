import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parse } from "smol-toml";
import { generatedGrokRule, grokRoleAgent } from "../src/generators.ts";
import { loadDelegation, type DelegationData } from "../src/delegation.ts";
import { parseFrontmatter } from "../src/lib.ts";
import { writeGrokCompatFlags } from "../src/host-sync.ts";

const REPO = join(import.meta.dir, "..");
const LIVE_CONFIG = `[cli]
installer = "internal"

[marketplace]
default_skills_installs_purged = true
official_marketplace_auto_installed = true

[[marketplace.sources]]
name = "xAI Official"
git = "https://github.com/xai-org/plugin-marketplace.git"
`;

describe("grok generated doctrine", () => {
  test("rule has the marker, four rows, and grok paths", () => {
    const [target, rule] = generatedGrokRule();
    expect(target).toBe(join(REPO, "grok", "rules", "doctrine.md"));
    expect(rule).toContain("<!-- GENERATED-GROK-DOCTRINE: source=CLAUDE.md+hosts/grok.md+delegation.toml -->");
    expect(rule).toContain("| implementer | grok-4.7 | grok-subagent |");
    expect(rule).toContain("runtime: grok-subagent");
    expect(rule).toContain("~/.grok/TENETS.md");
    expect(rule).toContain("~/.claude/CLAUDE.md");
    expect(rule).not.toContain("~/.claude/TENETS.md");
    expect(rule).not.toContain("grok-build-0.1");
    expect(rule).not.toContain("grok-4.7-build-fast");
    const table = rule.slice(rule.indexOf("<!-- DELEGATION:BEGIN -->"), rule.indexOf("<!-- DELEGATION:END -->"));
    const rows = table.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Role") && !line.startsWith("| ---"));
    expect(rows).toHaveLength(4);
    expect(table).not.toContain("implementer_light");
    expect(readFileSync(target, "utf-8")).toBe(rule);
  });
});

describe("grok agents", () => {
  test("three files pin grok-4.7 and the permission mode from the spec", () => {
    const data = loadDelegation(join(REPO, "delegation.toml"));
    for (const [role, file, permission] of [
      ["simplifier", "simplifier.md", "plan"],
      ["adv_review", "adv-review.md", "plan"],
      ["implementer", "implementer.md", "default"],
    ] as const) {
      const text = readFileSync(join(REPO, "grok", "agents", file), "utf-8");
      const { meta, body } = parseFrontmatter(text);
      expect(meta.model).toBe(data.grok[role].model);
      expect(meta.model).toBe("grok-4.7");
      expect(meta.permission_mode).toBe(permission);
      expect(meta.prompt_mode).toBe("full");
      expect(meta.agents_md).toBe("true");
      expect(body.trim()).toBe("read the porch note the parent names, trust it, do not spawn a subagent.");
    }
    expect(existsSync(join(REPO, "grok", "agents", "implementer-light.md"))).toBe(false);
  });

  test("scout agent has no model line because the binding is default", () => {
    const text = grokRoleAgent("scout")[1];
    const { meta } = parseFrontmatter(text);
    expect(meta.name).toBe("scout");
    expect(meta.permission_mode).toBe("plan");
    expect(text).not.toContain("model:");
  });

  test("a non-default scout model is written", () => {
    const data = loadDelegation(join(REPO, "delegation.toml")) as DelegationData;
    data.grok.scout = { model: "sentinel-grok-model", runtime: "grok-subagent" };
    expect(grokRoleAgent("scout", data)[1]).toContain("model: sentinel-grok-model");
  });

  test("the model string comes from delegation data", () => {
    const data = loadDelegation(join(REPO, "delegation.toml")) as DelegationData;
    data.grok.implementer = { model: "sentinel-grok-model", runtime: "grok-subagent" };
    expect(grokRoleAgent("implementer", data)[1]).toContain("model: sentinel-grok-model");
  });
});

describe("grok compat writer", () => {
  test("sets the four flags false and keeps the marketplace source", () => {
    const path = join(mkdtempSync(join(tmpdir(), "grok-config-")), "config.toml");
    writeFileSync(path, LIVE_CONFIG);
    writeGrokCompatFlags(path);
    const data = parse(readFileSync(path, "utf-8")) as {
      cli: { installer: string };
      marketplace: { sources: { name: string; git: string }[] };
      compat: {
        claude: { agents: boolean; rules: boolean; skills?: boolean };
        cursor: { agents: boolean; rules: boolean; hooks?: boolean };
      };
    };
    expect(data.cli.installer).toBe("internal");
    expect(data.compat.claude.agents).toBe(false);
    expect(data.compat.claude.rules).toBe(false);
    expect(data.compat.cursor.agents).toBe(false);
    expect(data.compat.cursor.rules).toBe(false);
    expect(data.compat.claude.skills).toBeUndefined();
    expect(data.compat.cursor.hooks).toBeUndefined();
    expect(data.marketplace.sources[0].name).toBe("xAI Official");
    expect(data.marketplace.sources[0].git).toBe("https://github.com/xai-org/plugin-marketplace.git");
  });

  test("a parse failure throws", () => {
    const path = join(mkdtempSync(join(tmpdir(), "grok-config-bad-")), "config.toml");
    writeFileSync(path, "[[[\n");
    expect(() => writeGrokCompatFlags(path)).toThrow(/parse failed/);
  });

  test("an empty file throws", () => {
    const path = join(mkdtempSync(join(tmpdir(), "grok-config-empty-")), "config.toml");
    writeFileSync(path, "");
    expect(() => writeGrokCompatFlags(path)).toThrow(/parse failed/);
    expect(readFileSync(path, "utf-8")).toBe("");
  });

  test("a missing path returns and leaves no file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "grok-config-missing-")), "config.toml");
    expect(existsSync(path)).toBe(false);
    expect(() => writeGrokCompatFlags(path)).not.toThrow();
    expect(existsSync(path)).toBe(false);
  });
});
