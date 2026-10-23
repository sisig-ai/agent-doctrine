import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { BEGIN, END, INVOKE, loadDelegation, renderDelegation } from "../src/delegation.ts";

const MINIMAL_TOML = `
[claude.simplifier]
model = "claude-opus-5-5"
runtime = "claude-agent"

[claude.adv_review]
model = "claude-opus-5-5"
runtime = "claude-agent"

[claude.implementer]
model = "claude-sonnet-5-5"
runtime = "claude-agent"

[claude.scout]
model = "claude-haiku-5-5"
runtime = "claude-agent"

[codex.simplifier]
model = "gpt-6.1-sol"
runtime = "codex-subagent"

[codex.adv_review]
model = "gpt-6.1-sol"
runtime = "codex-subagent"

[codex.implementer]
model = "gpt-6.1-sol"
runtime = "codex-subagent"

[codex.scout]
model = "gpt-6-luna"
runtime = "codex-subagent"

[cursor.simplifier]
model = "cursor-grok-4.7-high"
runtime = "cursor-subagent"

[cursor.adv_review]
model = "cursor-grok-4.7-high"
runtime = "cursor-subagent"

[cursor.implementer]
model = "composer-2.5"
runtime = "cursor-subagent"

[cursor.scout]
model = "composer-2.5"
runtime = "cursor-subagent"

[opencode.simplifier]
model = "opencode-go/mimo-v2.6-pro"
runtime = "opencode-subagent"

[opencode.adv_review]
model = "default"
runtime = "opencode-subagent"

[opencode.implementer]
model = "opencode-go/deepseek-v4.1-flash#high"
runtime = "opencode-subagent"

[opencode.scout]
model = "default"
runtime = "opencode-subagent"

[grok.simplifier]
model = "grok-4.7"
runtime = "grok-subagent"

[grok.adv_review]
model = "grok-4.7"
runtime = "grok-subagent"

[grok.implementer]
model = "grok-4.7"
runtime = "grok-subagent"

[grok.scout]
model = "default"
runtime = "grok-subagent"

[muse.simplifier]
model = "muse-wonder-1.0"
runtime = "muse-subagent"

[muse.adv_review]
model = "muse-wonder-1.0"
runtime = "muse-subagent"

[muse.implementer]
model = "muse-spark-1.3"
runtime = "muse-subagent"

[muse.scout]
model = "default"
runtime = "muse-subagent"
`;

const BODY_WITH_MARKERS = `# Role

Some text here.

${BEGIN}

old table

${END}

# Commit Messages
`;

describe("live delegation.toml", () => {
  test("simplifier and adv_review are host-native", () => {
    const data = loadDelegation(join(import.meta.dir, "..", "delegation.toml"));
    expect(data.claude.simplifier).toEqual({ model: "claude-opus-5-5", runtime: "claude-agent" });
    expect(data.claude.adv_review).toEqual({ model: "claude-opus-5-5", runtime: "claude-agent" });
    expect(data.codex.simplifier).toEqual({ model: "gpt-6.1-sol", runtime: "codex-subagent" });
    expect(data.codex.adv_review).toEqual({ model: "gpt-6.1-sol", runtime: "codex-subagent" });
    expect(data.cursor.simplifier).toEqual({ model: "cursor-grok-4.7-high", runtime: "cursor-subagent" });
    expect(data.cursor.adv_review).toEqual({ model: "cursor-grok-4.7-high", runtime: "cursor-subagent" });
  });

  test("opencode roles use the selected provider and model bindings", () => {
    const data = loadDelegation(join(import.meta.dir, "..", "delegation.toml"));
    expect(data.opencode.simplifier).toEqual({
      model: "opencode-go/mimo-v2.6-pro",
      runtime: "opencode-subagent",
    });
    expect(data.opencode.adv_review).toEqual({
      model: "default",
      runtime: "opencode-subagent",
    });
    expect(data.opencode.implementer).toEqual({
      model: "opencode-go/deepseek-v4.1-flash#high",
      runtime: "opencode-subagent",
    });
  });
});

describe("optional roles", () => {
  const repoToml = join(import.meta.dir, "..", "delegation.toml");
  const loadWith = (extra: string) => {
    const p = join(mkdtempSync(join(tmpdir(), "delegation-optional-")), "d.toml");
    writeFileSync(p, MINIMAL_TOML + extra);
    return p;
  };

  test("repo toml binds implementer_light and scout to haiku on claude", () => {
    const data = loadDelegation(repoToml);
    expect(data.claude.implementer_light).toEqual({ model: "claude-haiku-5-5", runtime: "claude-agent" });
    expect(data.claude.scout).toEqual({ model: "claude-haiku-5-5", runtime: "claude-agent" });
  });

  test("claude table lists scout then implementer_light after implementer", () => {
    const result = renderDelegation(BODY_WITH_MARKERS, "claude", loadDelegation(repoToml));
    expect(result).toContain("| implementer_light | claude-haiku-5-5 | claude-agent |");
    expect(result).toContain("| scout | claude-haiku-5-5 | claude-agent |");
    const order = ["simplifier", "adv_review", "implementer", "scout", "implementer_light"].map((r) =>
      result.indexOf(`| ${r} |`),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("targets without implementer_light keep four role rows", () => {
    const result = renderDelegation(BODY_WITH_MARKERS, "codex", loadDelegation(repoToml));
    const rows = result.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Role") && !l.startsWith("| ---"));
    expect(rows.length).toBe(4);
  });

  test("repo toml binds scout on every target", () => {
    const data = loadDelegation(repoToml);
    expect(data.codex.scout).toEqual({ model: "gpt-6-luna", runtime: "codex-subagent" });
    expect(data.cursor.scout).toEqual({ model: "composer-2.5", runtime: "cursor-subagent" });
    expect(data.opencode.scout).toEqual({ model: "default", runtime: "opencode-subagent" });
    expect(data.grok.scout).toEqual({ model: "default", runtime: "grok-subagent" });
    expect(data.muse.scout).toEqual({ model: "default", runtime: "muse-subagent" });
  });

  test("scout is required on every target", () => {
    const p = join(mkdtempSync(join(tmpdir(), "delegation-scout-required-")), "d.toml");
    writeFileSync(p, MINIMAL_TOML.replace(/\[grok\.scout\]\nmodel = "[^"]*"\nruntime = "[^"]*"\n/, ""));
    expect(() => loadDelegation(p)).toThrow(/missing role \[grok\.scout\]/);
  });

  test("the default model value is accepted and shown in the table", () => {
    const result = renderDelegation(BODY_WITH_MARKERS, "grok", loadDelegation(repoToml));
    expect(result).toContain("| scout | default | grok-subagent |");
  });

  test("repo toml binds four grok rows", () => {
    const data = loadDelegation(repoToml);
    expect(Object.keys(data.grok).sort()).toEqual(["adv_review", "implementer", "scout", "simplifier"]);
    expect(data.grok.simplifier).toEqual({ model: "grok-4.7", runtime: "grok-subagent" });
    expect(data.grok.adv_review).toEqual({ model: "grok-4.7", runtime: "grok-subagent" });
    expect(data.grok.implementer).toEqual({ model: "grok-4.7", runtime: "grok-subagent" });
    expect(data.grok.implementer_light).toBeUndefined();
  });

  test("repo toml binds muse wonder for review roles and spark for implementer", () => {
    const data = loadDelegation(repoToml);
    expect(Object.keys(data.muse).sort()).toEqual(["adv_review", "implementer", "scout", "simplifier"]);
    expect(data.muse.simplifier).toEqual({ model: "muse-wonder-1.0", runtime: "muse-subagent" });
    expect(data.muse.adv_review).toEqual({ model: "muse-wonder-1.0", runtime: "muse-subagent" });
    expect(data.muse.implementer).toEqual({ model: "muse-spark-1.3", runtime: "muse-subagent" });
    expect(data.muse.implementer_light).toBeUndefined();
  });

  test("unknown role still raises", () => {
    expect(() => loadDelegation(loadWith('\n[claude.helper]\nmodel = "claude-haiku-5-5"\nruntime = "claude-agent"\n'))).toThrow(
      /unknown role\(s\) under \[claude\]: helper/,
    );
  });

  test("optional role with a bad runtime raises", () => {
    expect(() =>
      loadDelegation(loadWith('\n[claude.implementer_light]\nmodel = "claude-haiku-5-5"\nruntime = "bad-runtime"\n')),
    ).toThrow(/bad-runtime/);
  });
});

describe("loadDelegation", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "delegation-"));
  });

  test("valid toml loads", () => {
    const p = join(root, "delegation.toml");
    writeFileSync(p, MINIMAL_TOML);
    const data = loadDelegation(p);
    expect(data.claude.simplifier.model).toBe("claude-opus-5-5");
    expect(data.claude.adv_review.model).toBe("claude-opus-5-5");
    expect(data.claude.adv_review.runtime).toBe("claude-agent");
    expect(data.codex.simplifier).toEqual({ model: "gpt-6.1-sol", runtime: "codex-subagent" });
    expect(data.codex.adv_review).toEqual({ model: "gpt-6.1-sol", runtime: "codex-subagent" });
    expect(data.codex.implementer).toEqual({ model: "gpt-6.1-sol", runtime: "codex-subagent" });
    expect(data.cursor.adv_review.model).toBe("cursor-grok-4.7-high");
    expect(data.cursor.adv_review.runtime).toBe("cursor-subagent");
    expect(data.cursor.implementer.model).toBe("composer-2.5");
  });

  test("missing target raises", () => {
    const p = join(root, "delegation.toml");
    writeFileSync(
      p,
      `[claude.simplifier]
model = "claude-opus-5-5"
runtime = "claude-agent"
[claude.adv_review]
model = "claude-opus-5-5"
runtime = "claude-agent"
[claude.implementer]
model = "claude-sonnet-5-5"
runtime = "claude-agent"
[claude.scout]
model = "claude-haiku-5-5"
runtime = "claude-agent"
`,
    );
    expect(() => loadDelegation(p)).toThrow(/codex/);
  });

  test("missing role raises", () => {
    const p = join(root, "delegation.toml");
    writeFileSync(
      p,
      MINIMAL_TOML.replace(
        "[codex.simplifier]\nmodel = \"gpt-6.1-sol\"\nruntime = \"codex-subagent\"\n\n",
        "",
      ),
    );
    expect(() => loadDelegation(p)).toThrow(/simplifier/);
  });

  test("unknown runtime raises", () => {
    const p = join(root, "delegation.toml");
    writeFileSync(p, MINIMAL_TOML.replace('runtime = "cursor-subagent"', 'runtime = "bad-runtime"'));
    expect(() => loadDelegation(p)).toThrow(/bad-runtime/);
  });
});

describe("renderDelegation", () => {
  let data: ReturnType<typeof loadDelegation>;

  beforeEach(() => {
    const p = join(mkdtempSync(join(tmpdir(), "delegation-load-")), "d.toml");
    writeFileSync(p, MINIMAL_TOML);
    data = loadDelegation(p);
  });

  test("replaces markers", () => {
    const result = renderDelegation(BODY_WITH_MARKERS, "claude", data);
    expect(result).toContain(BEGIN);
    expect(result).toContain(END);
    expect(result).not.toContain("old table");
  });

  test("claude table uses native claude agents", () => {
    const result = renderDelegation(BODY_WITH_MARKERS, "claude", data);
    expect(result).toContain("| simplifier | claude-opus-5-5 | claude-agent |");
    expect(result).toContain("| adv_review | claude-opus-5-5 | claude-agent |");
    expect(result).toContain(INVOKE["claude-agent"]);
    expect(result).toContain("claude-sonnet-5-5");
  });

  test("codex table uses native gpt-6.1-sol subagents", () => {
    const result = renderDelegation(BODY_WITH_MARKERS, "codex", data);
    expect(result).toContain("| simplifier | gpt-6.1-sol | codex-subagent |");
    expect(result).toContain("| adv_review | gpt-6.1-sol | codex-subagent |");
    expect(result).toContain("| implementer | gpt-6.1-sol | codex-subagent |");
  });

  test("cursor table uses native cursor subagents", () => {
    const result = renderDelegation(BODY_WITH_MARKERS, "cursor", data);
    expect(result).toContain("| simplifier | cursor-grok-4.7-high | cursor-subagent |");
    expect(result).toContain("| adv_review | cursor-grok-4.7-high | cursor-subagent |");
    expect(result).toContain(INVOKE["cursor-subagent"]);
    expect(result).toContain("composer-2.5");
  });

  test("grok table uses four rows", () => {
    const result = renderDelegation(BODY_WITH_MARKERS, "grok", data);
    expect(result).toContain("| simplifier | grok-4.7 | grok-subagent |");
    expect(result).toContain(INVOKE["grok-subagent"]);
    const rows = result.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Role") && !l.startsWith("| ---"));
    expect(rows).toHaveLength(4);
    expect(result).not.toContain("implementer_light");
    expect(result).not.toContain("grok-build-0.1");
  });

  test("a grok runtime other than grok-subagent throws", () => {
    const p = join(mkdtempSync(join(tmpdir(), "delegation-grok-runtime-")), "d.toml");
    writeFileSync(
      p,
      MINIMAL_TOML.replace(
        '[grok.simplifier]\nmodel = "grok-4.7"\nruntime = "grok-subagent"',
        '[grok.simplifier]\nmodel = "grok-4.7"\nruntime = "claude-agent"',
      ),
    );
    expect(() => loadDelegation(p)).toThrow(/invalid for \[grok\.simplifier\]/);
  });

  test("muse table uses wonder and spark rows", () => {
    const result = renderDelegation(BODY_WITH_MARKERS, "muse", data);
    expect(result).toContain("| simplifier | muse-wonder-1.0 | muse-subagent |");
    expect(result).toContain("| adv_review | muse-wonder-1.0 | muse-subagent |");
    expect(result).toContain("| implementer | muse-spark-1.3 | muse-subagent |");
    expect(result).toContain(INVOKE["muse-subagent"]);
    const rows = result.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Role") && !l.startsWith("| ---"));
    expect(rows).toHaveLength(4);
    expect(result).not.toContain("implementer_light");
  });

  test("a muse runtime other than muse-subagent throws", () => {
    const p = join(mkdtempSync(join(tmpdir(), "delegation-muse-runtime-")), "d.toml");
    writeFileSync(
      p,
      MINIMAL_TOML.replace(
        '[muse.simplifier]\nmodel = "muse-wonder-1.0"\nruntime = "muse-subagent"',
        '[muse.simplifier]\nmodel = "muse-wonder-1.0"\nruntime = "claude-agent"',
      ),
    );
    expect(() => loadDelegation(p)).toThrow(/invalid for \[muse\.simplifier\]/);
  });

  test("opencode table uses native opencode subagents", () => {
    const result = renderDelegation(BODY_WITH_MARKERS, "opencode", data);
    expect(result).toContain("| simplifier | opencode-go/mimo-v2.6-pro | opencode-subagent |");
    expect(result).toContain("| adv_review | default | opencode-subagent |");
    expect(result).toContain("| implementer | opencode-go/deepseek-v4.1-flash#high | opencode-subagent |");
    expect(result).toContain(INVOKE["opencode-subagent"]);
    expect(result).not.toContain("claude-agent");
  });

  test("rejects a runtime from another target", () => {
    const p = join(mkdtempSync(join(tmpdir(), "delegation-target-runtime-")), "d.toml");
    writeFileSync(p, MINIMAL_TOML.replace('runtime = "claude-agent"', 'runtime = "cursor-subagent"'));
    expect(() => loadDelegation(p)).toThrow(/invalid for \[claude\.simplifier\]/);
  });

  test("missing begin marker raises", () => {
    expect(() => renderDelegation("No markers here.\n", "claude", data)).toThrow(/BEGIN=0/);
  });

  test("idempotent", () => {
    const r1 = renderDelegation(BODY_WITH_MARKERS, "claude", data);
    const r2 = renderDelegation(r1, "claude", data);
    expect(r1).toBe(r2);
  });
});
