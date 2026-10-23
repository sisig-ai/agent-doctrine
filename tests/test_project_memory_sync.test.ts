import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join, resolve as pathResolve } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { atomicWrite } from "../src/lib.ts";
import * as p from "../src/project-memory.ts";

function git(args: string[], cwd?: string): string {
  const r = spawnSync("git", cwd ? ["-C", cwd, ...args] : args, { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "git failed");
  return r.stdout ?? "";
}

function realpath(path: string): string {
  return realpathSync(path);
}

function unit(id: string, ordinal: number, kind: string, text: string, sides: string[]): p.Unit {
  return { id, ordinal, kind, text, sides };
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function fakeRunner(
  calls: unknown[],
  handler: (payload: Record<string, unknown>, argv: string[]) => Record<string, unknown>,
  opts?: { timeout?: boolean; timeoutOnPreflight?: boolean },
) {
  return (argv: string[], runOpts?: { input?: Buffer; timeout?: number }) => {
    if (opts?.timeoutOnPreflight) {
      const err = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
      throw err;
    }
    if (argv[argv.length - 1] === "--help") {
      return { returncode: 0, stdout: Buffer.from("usage --safe-mode\n"), stderr: Buffer.alloc(0) };
    }
    if (argv[argv.length - 1] === "--version") {
      return { returncode: 0, stdout: Buffer.from("2.1.206\n"), stderr: Buffer.alloc(0) };
    }
    if (argv.slice(1).join(" ") === "auth status --json") {
      return {
        returncode: 0,
        stdout: Buffer.from(
          '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"never-store@example.com"}',
        ),
        stderr: Buffer.alloc(0),
      };
    }
    if (opts?.timeout) {
      throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    }
    const payload = JSON.parse(runOpts?.input?.toString("utf-8") ?? "{}") as Record<string, unknown>;
    calls.push(payload);
    const output = handler(payload, argv);
    return {
      returncode: 0,
      stdout: Buffer.from(JSON.stringify({ structured_output: output, model: "test", version: "1" })),
      stderr: Buffer.alloc(0),
    };
  };
}

describe("project memory sync", () => {
  let root: string;
  let repo: string;
  let remote: string;
  let checkout: string;
  let native: string;
  let config: string;
  let state: string;
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pm-"));
    repo = join(root, "doctrine");
    remote = join(root, "remote.git");
    checkout = join(root, "checkout");
    native = join(root, "native");
    config = join(root, "config.toml");
    state = join(root, "state");
    for (const [k, v] of [
      ["DOCTRINE_SYNC_CONFIG", config],
      ["DOCTRINE_SYNC_STATE", state],
    ] as const) {
      envBackup[k] = process.env[k];
      process.env[k] = v;
    }
    for (const path of [repo, checkout]) {
      mkdirSync(path);
      git(["init", "-q", "-b", "main"], path);
      git(["config", "user.email", "test@example.com"], path);
      git(["config", "user.name", "Test"], path);
    }
    git(["init", "-q", "--bare", remote]);
    git(["remote", "add", "origin", remote], repo);
    git(["remote", "add", "origin", "git@github.com:Org/repo.git"], checkout);
    writeFileSync(join(repo, "seed"), "x");
    git(["add", "seed"], repo);
    git(["commit", "-qm", "seed"], repo);
    git(["push", "-qu", "origin", "main"], repo);
    git(["fetch", "origin", "main"], repo);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function nativeFiles(files: Record<string, string>) {
    for (const [name, text] of Object.entries(files)) {
      const path = join(native, name);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, text);
    }
  }

  function register(projectId = "demo", regCheckout = checkout, regNative = native, opts?: { sharedRoot?: boolean }) {
    return p.register(repo, projectId, regCheckout, regNative, opts);
  }

  test("identity and router unregistered", () => {
    expect(p.normalizeGitIdentity("git@GitHub.com:Org/repo.git")).toBe("github.com/Org/repo");
    expect(p.projectPath(repo, checkout)).toBeNull();
  });

  test("preview rejects feature and detached head before mutation", () => {
    nativeFiles({ "MEMORY.md": "# M\n" });
    const record = register();
    const head = p.gitRef(repo, "HEAD");
    git(["checkout", "-qb", "feature"], repo);
    expect(() => p.preview(repo, record, { deletions: [] })).toThrow(/refs\/heads\/main/);
    expect(p.gitRef(repo, "HEAD")).toBe(head);
    git(["checkout", "-q", "--detach"], repo);
    expect(() => p.preview(repo, record, { deletions: [] })).toThrow(/refs\/heads\/main/);
  });

  test("native corpus includes additions and changes without reregistering", async () => {
    const literal = "token: literal\nMRN: literal\n";
    nativeFiles({ "MEMORY.md": "# Memory\n", "topic.md": literal });
    const record = register();
    const first = p.preview(repo, record, { deletions: [] });
    await p.apply(repo, record, String(first.approval_hash));
    expect(readFileSync(join(repo, "projects/demo/memory/topic.md"), "utf-8")).toBe(literal);
    const fresh: p.Registration = {
      project_id: "demo",
      checkout,
      native_memory: join(root, "literal-fresh"),
      identity: record.identity,
    };
    p.writeRegistry({ demo: fresh });
    unlinkSync(p.ledgerFile("demo"));
    await p.pull(repo, fresh);
    expect(readFileSync(join(fresh.native_memory, "topic.md"), "utf-8")).toBe(literal);
    p.writeRegistry({ demo: record });
    nativeFiles({ "topic.md": "changed\n", "later.md": "added\n" });
    const second = p.preview(repo, record, { deletions: [] });
    expect((second.writes as Record<string, string>)["topic.md"]).toBe("changed\n");
    expect((second.writes as Record<string, string>)["later.md"]).toBe("added\n");
  });

  test("registry round trip and canonical only registration", () => {
    const canonical = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(canonical, ".."), { recursive: true });
    writeFileSync(canonical, "# canonical\n");
    const record = register();
    expect(p.readRegistry()["demo"]).toEqual(record);
    expect(readFileSync(config, "utf-8")).not.toContain("classifications");
  });

  test("shared root registers non git exact root and moves between hosts", async () => {
    const realTestRoot = realpath(root);
    const shared = join(realTestRoot, "home-one");
    mkdirSync(shared);
    nativeFiles({ "MEMORY.md": "# Home\n" });
    const record = register("home", shared, native, { sharedRoot: true });
    expect(record.identity).toBe("shared:home");
    const artifact = p.preview(repo, record, { deletions: [] });
    await p.apply(repo, record, String(artifact.approval_hash));
    const expected = join(repo, "projects/home/memory");
    expect(p.projectPath(repo, shared)).toBe(expected);
    expect(p.manifestIdentity(repo, "home")).toBe("shared:home");

    const otherHostRoot = join(realTestRoot, "home-two");
    mkdirSync(otherHostRoot);
    const moved: p.Registration = { project_id: "home", checkout: otherHostRoot, native_memory: native, identity: "shared:home" };
    p.writeRegistry({ home: moved });
    expect(p.projectPath(repo, otherHostRoot)).toBe(expected);
    const nested = join(otherHostRoot, "nested");
    mkdirSync(nested);
    expect(p.projectPath(repo, nested)).toBeNull();
    const alias = join(realTestRoot, "home-alias");
    symlinkSync(otherHostRoot, alias);
    expect(p.projectPath(repo, alias)).toBeNull();
    expect(() => p.validateRegistration({ project_id: "home", checkout: alias, native_memory: native, identity: "shared:home" })).toThrow(
      /invalid shared root/,
    );
    const realParent = join(realTestRoot, "real-parent");
    const realChild = join(realParent, "child");
    mkdirSync(realChild, { recursive: true });
    const aliasParent = join(realTestRoot, "alias-parent");
    symlinkSync(realParent, aliasParent);
    const aliasChild = join(aliasParent, "child");
    p.writeRegistry({ home: { project_id: "home", checkout: realChild, native_memory: native, identity: "shared:home" } });
    expect(() =>
      p.validateRegistration({ project_id: "home", checkout: aliasChild, native_memory: native, identity: "shared:home" }),
    ).toThrow(/invalid shared root/);
    expect(p.projectPath(repo, aliasChild)).toBeNull();
  });

  test("shared registry rejects ambiguity duplicates and invalid ids", () => {
    const realTestRoot = realpath(root);
    const shared = join(realTestRoot, "shared");
    mkdirSync(shared);
    const other = join(realTestRoot, "other");
    mkdirSync(other);
    const one: p.Registration = { project_id: "one", checkout: shared, native_memory: native, identity: "shared:one" };
    const two: p.Registration = { project_id: "two", checkout: shared, native_memory: native, identity: "shared:two" };
    p.writeRegistry({ one, two });
    expect(() => p.projectPath(repo, shared)).toThrow(/ambiguous.*shared root/);

    const duplicate: p.Registration = { project_id: "two", checkout: other, native_memory: native, identity: "shared:one" };
    p.writeRegistry({ one, two: duplicate });
    expect(() => p.readRegistry()).toThrow(/duplicate shared identity/);
    const mismatched: p.Registration = { project_id: "one", checkout: shared, native_memory: native, identity: "shared:other" };
    p.writeRegistry({ one: mismatched });
    expect(() => p.readRegistry()).toThrow(/shared identity does not match project id/);
    expect(() => p.validateRegistration(mismatched)).toThrow(/shared identity does not match project id/);
    expect(() => p.normalizeIdentity("shared:Bad/ID")).toThrow(/invalid shared identity/);
  });

  test("git clone router ignores unrelated shared registration", async () => {
    nativeFiles({ "MEMORY.md": "# Git\n" });
    const gitRecord = register();
    const artifact = p.preview(repo, gitRecord, { deletions: [] });
    await p.apply(repo, gitRecord, String(artifact.approval_hash));
    const shared = join(realpath(root), "shared");
    mkdirSync(shared);
    const sharedRecord: p.Registration = {
      project_id: "home",
      checkout: shared,
      native_memory: join(root, "home-memory"),
      identity: "shared:home",
    };
    p.writeRegistry({ demo: gitRecord, home: sharedRecord });
    expect(p.projectPath(repo, checkout)).toBe(join(repo, "projects/demo/memory"));
  });

  test("legacy registry table is ignored and reregistered cleanly", () => {
    writeFileSync(
      config,
      `[projects.demo]
checkout = "/checkout"
native_memory = "/native"
identity = "github.com/org/repo"
[projects.demo.classifications."MEMORY.md"]
classification = "shared"
sha256s = ["00"]
`,
    );
    expect(p.readRegistry()["demo"].identity).toBe("github.com/org/repo");
    nativeFiles({ "MEMORY.md": "# M\n" });
    register();
    expect(readFileSync(config, "utf-8")).not.toContain("classifications");
  });

  test("preview version one requires regeneration", async () => {
    nativeFiles({ "MEMORY.md": "# M\n" });
    const record = register();
    const artifact = p.preview(repo, record, { deletions: [] });
    const stale = { ...artifact, version: 1 } as Record<string, unknown>;
    const proof = { ...stale };
    delete proof.approval_hash;
    stale.approval_hash = p.digest(p.canonicalJson(proof));
    atomicWrite(p.previewFile("demo", String(stale.approval_hash)), p.canonicalJson(stale));
    await expect(p.apply(repo, record, String(stale.approval_hash))).rejects.toThrow(/version/);
  });

  test("registration rejects non main and staged index before mutation", () => {
    nativeFiles({ "MEMORY.md": "# M\n" });
    const manifest = join(repo, "projects/demo/project.toml");
    const assertUnchanged = () => {
      expect(existsSync(manifest)).toBe(false);
      expect(existsSync(config)).toBe(false);
    };
    git(["checkout", "-qb", "feature"], repo);
    expect(() => register()).toThrow(/refs\/heads\/main/);
    assertUnchanged();
    git(["checkout", "-q", "main"], repo);
    git(["checkout", "-q", "--detach"], repo);
    expect(() => register()).toThrow(/refs\/heads\/main/);
    assertUnchanged();
    git(["checkout", "-q", "main"], repo);
    writeFileSync(join(repo, "staged"), "x\n");
    git(["add", "staged"], repo);
    expect(() => register()).toThrow(/pre-existing index/);
    assertUnchanged();
    expect(git(["diff", "--cached", "--name-only"], repo)).toContain("staged");
  });

  test("router rejects uncommitted canonical content and duplicate identity", () => {
    nativeFiles({ "MEMORY.md": "# M\n" });
    const record = register();
    const memRoot = join(repo, "projects/demo/memory");
    mkdirSync(memRoot, { recursive: true });
    writeFileSync(join(memRoot, "MEMORY.md"), "# M\n");
    expect(() => p.projectPath(repo, checkout)).toThrow(/committed canonical inventory/);
    const duplicate: p.Registration = { project_id: "second", checkout, native_memory: native, identity: record.identity };
    p.writeRegistry({ demo: record, second: duplicate });
    expect(() => p.projectPath(repo, checkout)).toThrow(/ambiguous/);
  });

  test("corpus syncs without index or markdown shape gate", async () => {
    nativeFiles({ "topic.MD": "```\nunclosed\n", "nested/notes.md": "[outside](../missing.md)\n" });
    writeFileSync(join(native, ".DS_Store"), "ignored");
    writeFileSync(join(native, "notes.txt"), "ignored\n");
    const record = register();
    const artifact = p.preview(repo, record, { deletions: [] });
    expect(new Set(Object.keys(artifact.writes as Record<string, string>))).toEqual(new Set(["topic.MD", "nested/notes.md"]));
    await p.apply(repo, record, String(artifact.approval_hash));
    const fresh: p.Registration = {
      project_id: "demo",
      checkout,
      native_memory: join(root, "shape-fresh"),
      identity: record.identity,
    };
    p.writeRegistry({ demo: fresh });
    unlinkSync(p.ledgerFile("demo"));
    await p.pull(repo, fresh);
    expect(readFileSync(join(fresh.native_memory, "topic.MD"), "utf-8")).toBe("```\nunclosed\n");
    expect(readFileSync(join(fresh.native_memory, "nested/notes.md"), "utf-8")).toBe("[outside](../missing.md)\n");
  });

  test("corpus rejects symlinked markdown input", () => {
    mkdirSync(native);
    const outside = join(root, "outside.md");
    writeFileSync(outside, "outside\n");
    symlinkSync(outside, join(native, "linked.md"));
    expect(() => p.corpus(native)).toThrow(/symlink/);
  });

  test("blocks keep frontmatter fences tables and nested lists", () => {
    const text = Buffer.from("---\na: b\n---\n\n# H\n\n```\ncode\n```\n\n|a|b|\n|-|-|\n|1|2|\n\n- outer\n  - child\n");
    const blocks = p.markdownBlocks("native", "MEMORY.md", text);
    const joined = blocks.map((b) => b.text).join("");
    expect(joined).toContain("code\n```");
    expect(joined).toContain("  - child");
  });

  test("top level list items are independent units", () => {
    const blocks = p.markdownBlocks("native", "MEMORY.md", Buffer.from("- first\n  continuation\n  - nested\n- second\n"));
    expect(blocks.length).toBe(2);
    expect(blocks[0]!.text).toContain("nested");
    expect(blocks[1]!.text).toBe("- second\n");
  });

  test("reconcile bootstrap edit and explicit deletion", () => {
    const base = { "MEMORY.md": Buffer.from("# M\n"), "a.md": Buffer.from("old\n") };
    const [intended, conflicts] = p.reconcile(
      base,
      { "MEMORY.md": Buffer.from("# M\n"), "a.md": Buffer.from("old\n") },
      { "MEMORY.md": Buffer.from("# M\n"), "a.md": Buffer.from("new\n") },
      new Set(),
    );
    expect(intended["a.md"]!.toString()).toBe("new\n");
    expect(conflicts).toEqual([]);
    const [, c2] = p.reconcile(
      base,
      { "MEMORY.md": Buffer.from("# M\n") },
      { "MEMORY.md": Buffer.from("# M\n"), "a.md": Buffer.from("old\n") },
      new Set(),
    );
    expect(c2).toEqual(["a.md"]);
  });

  test("sparse plan keeps 95 aligned units without growing", () => {
    const text = Buffer.from([...Array(95)].map((_, i) => `- fact ${i}\n`).join(""));
    const units = p.alignedUnits("MEMORY.md", null, text, text);
    expect(units.length).toBe(95);
    const plan = { schema_version: 2, conflict_id: "c", ordered_source_ids: null, dispositions: [], contradictions: [] };
    p.validateMergePlan(plan, "c", units);
    expect(p.renderPlan(plan, units)).toEqual(Buffer.from(units.map((u) => u.text).join("\n")));
    expect(p.canonicalJson(plan).length).toBeLessThan(150);
  });

  test("plan validation rejects hallucinated order and keeps both verbatim", () => {
    const units = p.alignedUnits("MEMORY.md", Buffer.from("base\n"), Buffer.from("left\n"), Buffer.from("right\n"));
    const ids = units.map((u) => u.id);
    const plan = {
      schema_version: 2,
      conflict_id: "c",
      ordered_source_ids: null as string[] | null,
      dispositions: [],
      contradictions: [
        {
          source_ids: ids.slice(0, 2),
          resolution: "keep_both",
          winner_source_id: null,
          evidence_source_ids: [],
          rationale: "ambiguous",
        },
      ],
    };
    p.validateMergePlan(plan, "c", units);
    expect(p.renderPlan(plan, units).toString()).not.toContain("project-memory");
    plan.ordered_source_ids = ["invented"];
    expect(() => p.validateMergePlan(plan, "c", units)).toThrow(p.ProjectMemoryError);
  });

  test("sparse removal rules for duplicates and supersession", () => {
    const units = [
      unit("a", 0, "paragraph", "same", ["canonical"]),
      unit("b", 1, "paragraph", "same", ["native"]),
      unit("c", 2, "paragraph", "corrected", ["native"]),
    ];
    const exact = {
      schema_version: 2,
      conflict_id: "c",
      ordered_source_ids: null as string[] | null,
      dispositions: [{ source_id: "a", status: "duplicate", target_source_id: "b", reason_code: "exact_duplicate", rationale: "identical" }],
      contradictions: [],
    };
    p.validateMergePlan(exact, "c", units);
    const semantic = deepCopy(exact);
    semantic.dispositions[0].reason_code = "semantic_duplicate";
    p.validateMergePlan(semantic, "c", units);
    const superseded = {
      schema_version: 2,
      conflict_id: "c",
      ordered_source_ids: null,
      dispositions: [{ source_id: "a", status: "superseded", target_source_id: "c", reason_code: "explicit_correction", rationale: "corrected" }],
      contradictions: [
        { source_ids: ["a", "c"], resolution: "keep_winner", winner_source_id: "c", evidence_source_ids: ["c"], rationale: "explicit correction" },
      ],
    };
    p.validateMergePlan(superseded, "c", units);
    const externalEvidence = deepCopy(superseded);
    externalEvidence.contradictions[0].evidence_source_ids = ["b"];
    p.validateMergePlan(externalEvidence, "c", units);
    const unknownEvidence = deepCopy(superseded);
    unknownEvidence.contradictions[0].evidence_source_ids = ["unknown"];
    expect(() => p.validateMergePlan(unknownEvidence, "c", units)).toThrow(/invalid contradiction IDs/);
    const wrongExact = deepCopy(exact);
    wrongExact.dispositions[0].target_source_id = "c";
    expect(() => p.validateMergePlan(wrongExact, "c", units)).toThrow(/exact duplicate/);
    for (const [sourceId, targetSourceId, status] of [
      ["unknown", "b", "duplicate"],
      ["a", "a", "duplicate"],
      ["a", null, "preserved"],
    ] as const) {
      const invalid = deepCopy(exact);
      Object.assign(invalid.dispositions[0], { source_id: sourceId, target_source_id: targetSourceId, status });
      expect(() => p.validateMergePlan(invalid, "c", units)).toThrow(p.ProjectMemoryError);
    }
  });

  test("sparse plan rejects invalid targets contradictions orders and base removal", () => {
    const units = [
      unit("a", 0, "paragraph", "old", ["canonical"]),
      unit("b", 1, "paragraph", "new", ["native"]),
      unit("base", 2, "paragraph", "restore", ["base"]),
    ];
    const valid = {
      schema_version: 2,
      conflict_id: "c",
      ordered_source_ids: null as string[] | null,
      dispositions: [{ source_id: "a", status: "superseded", target_source_id: "b", reason_code: "explicit_newer_evidence", rationale: "newer" }],
      contradictions: [{ source_ids: ["a", "b"], resolution: "keep_winner", winner_source_id: "b", evidence_source_ids: ["b"], rationale: "dated" }],
    };
    p.validateMergePlan(valid, "c", units);
    const reordered = deepCopy(valid);
    reordered.ordered_source_ids = ["base", "b"];
    p.validateMergePlan(reordered, "c", units);
    expect(p.renderPlan(reordered, units)).toEqual(Buffer.from("restore\nnew"));
    const invalidPlans: Record<string, unknown>[] = [];
    const removedTarget = deepCopy(valid);
    removedTarget.dispositions.push({
      source_id: "b",
      status: "duplicate",
      target_source_id: "base",
      reason_code: "semantic_duplicate",
      rationale: "same",
    });
    invalidPlans.push(removedTarget);
    const missingContradiction = deepCopy(valid);
    missingContradiction.contradictions = [];
    invalidPlans.push(missingContradiction);
    const duplicateContradiction = deepCopy(valid);
    duplicateContradiction.contradictions = [...duplicateContradiction.contradictions, ...duplicateContradiction.contradictions];
    invalidPlans.push(duplicateContradiction);
    const baseRemoval = deepCopy(valid);
    baseRemoval.dispositions = [{ source_id: "base", status: "duplicate", target_source_id: "b", reason_code: "semantic_duplicate", rationale: "same" }];
    baseRemoval.contradictions = [];
    invalidPlans.push(baseRemoval);
    for (const order of [["b", "base", "invented"], ["a", "b", "base"], ["b"], ["b", "b", "base"], []]) {
      const badOrder = deepCopy(valid);
      badOrder.ordered_source_ids = order;
      invalidPlans.push(badOrder);
    }
    for (const plan of invalidPlans) {
      expect(() => p.validateMergePlan(plan, "c", units)).toThrow(p.ProjectMemoryError);
    }
  });

  test("plan validation rejects scalar items as project memory errors", () => {
    const units = [unit("a", 0, "paragraph", "fact", ["native"])];
    for (const [dispositions, contradictions] of [
      [[1], []],
      [[], ["not-an-object"]],
    ] as const) {
      const plan = { schema_version: 2, conflict_id: "c", ordered_source_ids: null, dispositions, contradictions };
      expect(() => p.validateMergePlan(plan, "c", units)).toThrow(p.ProjectMemoryError);
    }
  });

  test("ledger is versioned private and fail closed", () => {
    p.writeLedger("demo", { "MEMORY.md": Buffer.from("# M\n") });
    expect(p.readLedger("demo")["MEMORY.md"]!.toString()).toBe("# M\n");
    expect(statSync(p.ledgerFile("demo")).mode & 0o777).toBe(0o600);
    atomicWrite(p.ledgerFile("bad"), Buffer.from('{"version":0}'));
    expect(() => p.readLedger("bad")).toThrow(p.ProjectMemoryError);
  });

  test("safe mode oauth preflight and exact isolated argv", () => {
    const fake = join(root, "fake-claude");
    writeFileSync(fake, "#!/bin/sh\n");
    chmodSync(fake, 0o755);
    const calls: { argv: string[]; opts?: { timeout?: number; input?: Buffer } }[] = [];
    const runner = (argv: string[], opts?: { input?: Buffer; timeout?: number }) => {
      calls.push({ argv, opts });
      if (argv[argv.length - 1] === "--help") return { returncode: 0, stdout: Buffer.from("usage --safe-mode\n"), stderr: Buffer.alloc(0) };
      if (argv[argv.length - 1] === "--version") return { returncode: 0, stdout: Buffer.from("2.1.206\n"), stderr: Buffer.alloc(0) };
      if (argv.slice(1).join(" ") === "auth status --json") {
        return {
          returncode: 0,
          stdout: Buffer.from('{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"never-store@example.com"}'),
          stderr: Buffer.alloc(0),
        };
      }
      return { returncode: 0, stdout: Buffer.from('{"structured_output":{"ok":true},"model":"resolved"}'), stderr: Buffer.alloc(0) };
    };
    const runtime = p.claudePreflight(fake, runner);
    expect(calls.slice(0, 3).every((c) => c.opts?.timeout === p.CLAUDE_CALL_TIMEOUT_SECONDS)).toBe(true);
    const [output, metadata] = p.invokeClaude(runtime, "fixed", { type: "object" }, { x: "in stdin" }, "claude-3-test", runner);
    const last = calls[calls.length - 1]!;
    expect(output).toEqual({ ok: true });
    expect(last.opts?.input?.toString()).toBe('{"x":"in stdin"}');
    expect(last.opts?.timeout).toBe(p.CLAUDE_CALL_TIMEOUT_SECONDS);
    expect(last.argv).toContain("--safe-mode");
    expect(last.argv).not.toContain("--bare");
    expect(last.argv[last.argv.indexOf("--setting-sources") + 1]).toBe("");
    expect(last.argv[last.argv.indexOf("--mcp-config") + 1]).toBe('{"mcpServers":{}}');
    const schemaArg = last.argv[last.argv.indexOf("--json-schema") + 1]!;
    expect(JSON.parse(schemaArg)).toEqual({ type: "object" });
    expect(schemaArg.startsWith("/")).toBe(false);
    expect(metadata.isolation_mode).toBe("safe-mode");
    expect(JSON.stringify(metadata)).not.toContain("email");
    for (const name of [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "CLAUDE_CODE_USE_FOUNDRY",
    ]) {
      const prev = process.env[name];
      process.env[name] = "set";
      expect(() => p.claudePreflight(fake, runner)).toThrow(p.ProjectMemoryError);
      if (prev === undefined) delete process.env[name];
      else process.env[name] = prev;
    }
  });

  test("claude preflight timeout is bounded and fails closed", () => {
    const fake = join(root, "fake-claude");
    writeFileSync(fake, "#!/bin/sh\n");
    chmodSync(fake, 0o755);
    const timeouts: (number | undefined)[] = [];
    const runner = (argv: string[], opts?: { timeout?: number }) => {
      timeouts.push(opts?.timeout);
      throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    };
    expect(() => p.claudePreflight(fake, runner)).toThrow(/Claude preflight timed out/);
    expect(timeouts).toEqual([p.CLAUDE_CALL_TIMEOUT_SECONDS]);
  });

  test("merge uses real envelope and never auth bypasses", () => {
    const fake = join(root, "fake-claude");
    writeFileSync(fake, "#!/bin/sh\n");
    chmodSync(fake, 0o755);
    const calls: Record<string, unknown>[] = [];
    const runner = fakeRunner(calls, (payload) => {
      if ("input" in payload) {
        return { schema_version: 1, conflict_id: payload.conflict_id, verdict: "pass", findings: [] };
      }
      return { schema_version: 2, conflict_id: payload.conflict_id, ordered_source_ids: null, dispositions: [], contradictions: [] };
    });
    const [rendered, audit] = p.mergeConflict("MEMORY.md", Buffer.from("base\n"), Buffer.from("token: left\n"), Buffer.from("MRN: right\n"), fake, "claude-test-1", runner);
    expect(calls.length).toBe(2);
    expect(rendered.toString()).toContain("token: left");
    expect(rendered.toString()).toContain("MRN: right");
    expect((audit.merger as Record<string, unknown>).requested_model).toBe("claude-test-1");
    expect(calls[0]!.default_ordered_source_ids).toEqual(
      p.alignedUnits("MEMORY.md", Buffer.from("base\n"), Buffer.from("token: left\n"), Buffer.from("MRN: right\n")).map((u) => u.id),
    );
    const [cachedRendered, cachedAudit] = p.mergeConflict(
      "MEMORY.md",
      Buffer.from("base\n"),
      Buffer.from("token: left\n"),
      Buffer.from("MRN: right\n"),
      fake,
      "claude-test-1",
      () => {
        throw new Error("cache hit invoked Claude");
      },
    );
    expect(cachedRendered.equals(rendered)).toBe(true);
    expect(p.canonicalJson(cachedAudit).toString()).toBe(p.canonicalJson(audit).toString());
  });

  test("verified merge cache misses on input model contract render and invalid plan", () => {
    const fake = join(root, "fake-claude");
    writeFileSync(fake, "#!/bin/sh\n");
    chmodSync(fake, 0o755);
    const runtime = p.claudePreflight(fake, (argv, opts) =>
      fakeRunner([], (payload) => {
        if ("input" in payload) {
          return { schema_version: 1, conflict_id: payload.conflict_id, verdict: "pass", findings: [] };
        }
        return { schema_version: 2, conflict_id: payload.conflict_id, ordered_source_ids: null, dispositions: [], contradictions: [] };
      })(argv, opts),
    );
    const calls: Record<string, unknown>[] = [];
    const runner = fakeRunner(calls, (payload) => {
      if ("input" in payload) {
        return { schema_version: 1, conflict_id: payload.conflict_id, verdict: "pass", findings: [] };
      }
      return { schema_version: 2, conflict_id: payload.conflict_id, ordered_source_ids: null, dispositions: [], contradictions: [] };
    });
    const inputs = ["MEMORY.md", Buffer.from("base\n"), Buffer.from("left\n"), Buffer.from("right\n"), fake] as const;
    p.mergeConflict(...inputs, "model-a", runner, runtime);
    const conflictId = String(calls[0]!.conflict_id);
    const cacheFile = join(state, "verified-merges", `${conflictId}.json`);
    const baseline = JSON.parse(readFileSync(cacheFile, "utf-8"));
    expect(calls.length).toBe(2);
    expect(new Set(Object.keys(baseline))).toEqual(
      new Set(["version", "conflict_id", "input_hash", "contract_hash", "requested_model", "rendered_sha256", "verifier_input_sha256", "audit_sha256", "audit"]),
    );

    atomicWrite(cacheFile, p.canonicalJson(baseline));
    p.mergeConflict(...inputs, "model-b", runner, runtime);
    expect(calls.length).toBe(4);

    for (const field of ["contract_hash", "rendered_sha256"] as const) {
      const tampered = deepCopy(baseline);
      tampered[field] = "tampered";
      atomicWrite(cacheFile, p.canonicalJson(tampered));
      const before = calls.length;
      p.mergeConflict(...inputs, "model-a", runner, runtime);
      expect(calls.length).toBe(before + 2);
    }

    const invalid = deepCopy(baseline);
    invalid.audit.plan.dispositions = [1];
    atomicWrite(cacheFile, p.canonicalJson(invalid));
    let before = calls.length;
    p.mergeConflict(...inputs, "model-a", runner, runtime);
    expect(calls.length).toBe(before + 2);

    const changedPlan = deepCopy(baseline);
    const units = p.alignedUnits("MEMORY.md", Buffer.from("base\n"), Buffer.from("left\n"), Buffer.from("right\n"));
    changedPlan.audit.plan.ordered_source_ids = units.map((u) => u.id).reverse();
    changedPlan.rendered_sha256 = p.digest(p.renderPlan(changedPlan.audit.plan, units));
    changedPlan.audit_sha256 = p.digest(p.canonicalJson(changedPlan.audit));
    atomicWrite(cacheFile, p.canonicalJson(changedPlan));
    before = calls.length;
    p.mergeConflict(...inputs, "model-a", runner, runtime);
    expect(calls.length).toBe(before + 2);

    const changedAttempts = deepCopy(baseline);
    changedAttempts.audit.failed_attempts = [[{ code: "broken_structure" }]];
    atomicWrite(cacheFile, p.canonicalJson(changedAttempts));
    before = calls.length;
    p.mergeConflict(...inputs, "model-a", runner, runtime);
    expect(calls.length).toBe(before + 2);

    for (const invocation of ["merger", "verifier_invocation"] as const) {
      const changedProvenance = deepCopy(baseline);
      changedProvenance.audit[invocation].resolved_model = "tampered";
      atomicWrite(cacheFile, p.canonicalJson(changedProvenance));
      before = calls.length;
      p.mergeConflict(...inputs, "model-a", runner, runtime);
      expect(calls.length).toBe(before + 2);
    }

    before = calls.length;
    p.mergeConflict("MEMORY.md", Buffer.from("base\n"), Buffer.from("left\n"), Buffer.from("changed input\n"), fake, "model-a", runner, runtime);
    expect(calls.length).toBe(before + 2);
  });

  test("first dual presence preview uses agent with absent base", () => {
    nativeFiles({ "MEMORY.md": "# Native\n" });
    const canonical = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(canonical, ".."), { recursive: true });
    writeFileSync(canonical, "# Canonical\n");
    const record = register();
    const fake = join(root, "fake-claude");
    writeFileSync(fake, "#!/bin/sh\n");
    chmodSync(fake, 0o755);
    const calls: Record<string, unknown>[] = [];
    const runner = fakeRunner(calls, (payload) => {
      if (!("input" in payload)) {
        return { schema_version: 2, conflict_id: payload.conflict_id, ordered_source_ids: null, dispositions: [], contradictions: [] };
      }
      return { schema_version: 1, conflict_id: payload.conflict_id, verdict: "pass", findings: [] };
    });
    const artifact = p.preview(repo, record, { deletions: [], claudeBinary: fake, model: "claude-test", runner });
    expect(calls[0]!.base).toBeNull();
    expect(calls.length).toBe(2);
    expect((artifact.writes as Record<string, string>)["MEMORY.md"]).toContain("Native");
  });

  test("recognized memory index merges without claude preflight", () => {
    const base = "# Memory Index\n\n- [A](a.md) — alpha\n\n";
    const canonicalText = "# Memory Index\n\n- [A](a.md) — alpha\n\n- [B](b.md) — beta\n\n";
    const nativeText = "# Memory Index\n\n- [A](a.md) — alpha\n\n- [C](c.md) — gamma\n\n";
    nativeFiles({ "MEMORY.md": nativeText, "a.md": "a\n", "b.md": "b\n", "c.md": "c\n" });
    const mem = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(mem, ".."), { recursive: true });
    writeFileSync(mem, canonicalText);
    writeFileSync(join(mem, "..", "a.md"), "a\n");
    writeFileSync(join(mem, "..", "b.md"), "b\n");
    const record = register();
    p.writeLedger("demo", { "MEMORY.md": Buffer.from(base), "a.md": Buffer.from("a\n"), "b.md": Buffer.from("b\n") });
    const artifact = p.preview(repo, record, { deletions: [] });
    const writes = artifact.writes as Record<string, string>;
    expect(writes["MEMORY.md"]).toContain("b.md");
    expect(writes["MEMORY.md"]).toContain("c.md");
    expect(writes["c.md"]).toBe("c\n");
    const audit = (artifact.audits as Record<string, Record<string, unknown>>)["MEMORY.md"];
    expect(audit.strategy).toBe("keyed-memory-index");
  });

  test("same-key memory index conflict fails before preview artifact", () => {
    const base = "# Memory Index\n\n- [A](a.md) — alpha\n\n";
    const canonicalText = "# Memory Index\n\n- [A](a.md) — canon\n\n";
    const nativeText = "# Memory Index\n\n- [A](a.md) — native\n\n";
    nativeFiles({ "MEMORY.md": nativeText, "a.md": "a\n" });
    const mem = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(mem, ".."), { recursive: true });
    writeFileSync(mem, canonicalText);
    writeFileSync(join(mem, "..", "a.md"), "a\n");
    const record = register();
    p.writeLedger("demo", { "MEMORY.md": Buffer.from(base), "a.md": Buffer.from("a\n") });
    expect(() => p.preview(repo, record, { deletions: [] })).toThrow(/memory index conflict on a\.md/);
    expect(readFileSync(mem, "utf-8")).toBe(canonicalText);
    expect(readFileSync(join(native, "MEMORY.md"), "utf-8")).toBe(nativeText);
  });

  test("apply converges exact bytes without model calls", async () => {
    nativeFiles({ "MEMORY.md": "# New\n" });
    const canonical = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(canonical, ".."), { recursive: true });
    writeFileSync(canonical, "# Old\n");
    const record = register();
    p.writeLedger("demo", { "MEMORY.md": Buffer.from("# Old\n") });
    const artifact = p.preview(repo, record, { deletions: [] });
    const changed = await p.apply(repo, record, String(artifact.approval_hash));
    expect(readFileSync(canonical, "utf-8")).toBe("# New\n");
    expect(readFileSync(join(native, "MEMORY.md"), "utf-8")).toBe("# New\n");
    expect(changed.some((c) => c.includes("project.toml"))).toBe(true);
    expect(p.readLedger("demo")["MEMORY.md"]!.toString()).toBe("# New\n");
  });

  test("inventory allows fresh host pull and router", async () => {
    nativeFiles({ "MEMORY.md": "# New\n" });
    const canonical = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(canonical, ".."), { recursive: true });
    writeFileSync(canonical, "# Old\n");
    const record = register();
    p.writeLedger("demo", { "MEMORY.md": Buffer.from("# Old\n") });
    const artifact = p.preview(repo, record, { deletions: [] });
    await p.apply(repo, record, String(artifact.approval_hash));
    const freshNative = join(root, "fresh-native");
    const fresh: p.Registration = { project_id: "demo", checkout, native_memory: freshNative, identity: record.identity };
    p.writeRegistry({ demo: fresh });
    unlinkSync(p.ledgerFile("demo"));
    expect(p.projectPath(repo, checkout)).toBe(join(repo, "projects/demo/memory"));
    await p.pull(repo, fresh);
    expect(readFileSync(join(freshNative, "MEMORY.md"), "utf-8")).toBe("# New\n");
  });

  test("same bytes bootstrap commits memory from empty inventory", async () => {
    nativeFiles({ "MEMORY.md": "# Shared\n" });
    const canonical = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(canonical, ".."), { recursive: true });
    writeFileSync(canonical, "# Shared\n");
    const record = register();
    const artifact = p.preview(repo, record, { deletions: [] });
    await p.apply(repo, record, String(artifact.approval_hash));
    const commit = p.gitRef(repo, "origin/main");
    expect(spawnSync("git", ["-C", repo, "show", `${commit}:projects/demo/memory/MEMORY.md`], { encoding: "buffer" }).stdout).toEqual(
      Buffer.from("# Shared\n"),
    );
    const fresh: p.Registration = { project_id: "demo", checkout, native_memory: join(root, "fresh"), identity: record.identity };
    p.writeRegistry({ demo: fresh });
    unlinkSync(p.ledgerFile("demo"));
    await p.pull(repo, fresh);
    expect(readFileSync(join(fresh.native_memory, "MEMORY.md"), "utf-8")).toBe("# Shared\n");
  });

  test("second transaction adds edits and deletes exact remote subtree", async () => {
    nativeFiles({ "MEMORY.md": "# One\n", "old.md": "old\n" });
    const memRoot = join(repo, "projects/demo/memory");
    mkdirSync(memRoot, { recursive: true });
    writeFileSync(join(memRoot, "MEMORY.md"), "# One\n");
    writeFileSync(join(memRoot, "old.md"), "old\n");
    const record = register();
    await p.apply(repo, record, String(p.preview(repo, record, { deletions: [] }).approval_hash));
    writeFileSync(join(native, "MEMORY.md"), "# Two\n");
    unlinkSync(join(native, "old.md"));
    writeFileSync(join(native, "new.md"), "new\n");
    const unrelated = join(repo, "unrelated.txt");
    writeFileSync(unrelated, "keep\n");
    const artifact = p.preview(repo, record, { deletions: ["old.md"] });
    await p.apply(repo, record, String(artifact.approval_hash));
    const commit = p.gitRef(repo, "origin/main");
    const subtree = git(["ls-tree", "-r", "--name-only", commit, "--", "projects/demo/memory"], repo)
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(subtree).toEqual(["projects/demo/memory/MEMORY.md", "projects/demo/memory/new.md"]);
    expect(readFileSync(join(native, "MEMORY.md"), "utf-8")).toBe("# Two\n");
    expect(readFileSync(unrelated, "utf-8")).toBe("keep\n");
    expect(p.gitRef(repo, "HEAD")).toBe(p.gitRef(repo, "origin/main"));
  });

  test("pull transfers every canonical markdown file", async () => {
    nativeFiles({ "MEMORY.md": "# M\n", "topic.md": "operator note\n" });
    const record = register();
    await p.apply(repo, record, String(p.preview(repo, record, { deletions: [] }).approval_hash));
    const fresh: p.Registration = { project_id: "demo", checkout, native_memory: join(root, "fresh-native"), identity: record.identity };
    p.writeRegistry({ demo: fresh });
    unlinkSync(p.ledgerFile("demo"));
    await p.pull(repo, fresh);
    expect(readFileSync(join(fresh.native_memory, "MEMORY.md"), "utf-8")).toBe("# M\n");
    expect(readFileSync(join(fresh.native_memory, "topic.md"), "utf-8")).toBe("operator note\n");
  });

  test("pull preserves native-only files without crashing when base ledger is absent", async () => {
    nativeFiles({ "MEMORY.md": "# M\n", "topic.md": "operator note\n" });
    const record = register();
    await p.apply(repo, record, String(p.preview(repo, record, { deletions: [] }).approval_hash));
    // Fresh host seeded out-of-band (e.g. via rsync) with a native-only file and
    // no ledger: base is empty, so base[name] is undefined for that file. This
    // used to throw a TypeError on `.equals(undefined)` instead of pulling.
    const freshNative = join(root, "fresh-native");
    mkdirSync(freshNative, { recursive: true });
    writeFileSync(join(freshNative, "local_only.md"), "local\n");
    const fresh: p.Registration = { project_id: "demo", checkout, native_memory: freshNative, identity: record.identity };
    p.writeRegistry({ demo: fresh });
    unlinkSync(p.ledgerFile("demo"));
    await p.pull(repo, fresh);
    expect(readFileSync(join(freshNative, "MEMORY.md"), "utf-8")).toBe("# M\n");
    expect(readFileSync(join(freshNative, "topic.md"), "utf-8")).toBe("operator note\n");
    expect(readFileSync(join(freshNative, "local_only.md"), "utf-8")).toBe("local\n");
  });

  test("pull refuses divergent native content and preserves it", async () => {
    nativeFiles({ "MEMORY.md": "# M\n" });
    const canonical = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(canonical, ".."), { recursive: true });
    writeFileSync(canonical, "# M\n");
    const record = register();
    const artifact = p.preview(repo, record, { deletions: [] });
    await p.apply(repo, record, String(artifact.approval_hash));
    writeFileSync(join(native, "MEMORY.md"), "changed\n");
    const invokeSpy = spyOn(p, "invokeClaude");
    await expect(p.pull(repo, record)).rejects.toThrow(p.ProjectMemoryError);
    expect(invokeSpy.mock.calls.length).toBe(0);
    invokeSpy.mockRestore();
    expect(readFileSync(join(native, "MEMORY.md"), "utf-8")).toBe("changed\n");
  });

  test("project commit rejects pre staged content without touching head", () => {
    const head = p.gitRef(repo, "HEAD");
    writeFileSync(join(repo, "unrelated"), "staged\n");
    git(["add", "unrelated"], repo);
    expect(() => p.projectCommitPush(repo, head, ["projects/demo/project.toml"], () => {})).toThrow(/pre-existing index/);
    expect(p.gitRef(repo, "HEAD")).toBe(head);
    expect(git(["diff", "--cached", "--name-only"], repo)).toContain("unrelated");
  });

  test("pending schema is private and fails closed", () => {
    nativeFiles({ "MEMORY.md": "# M\n" });
    const record = register();
    atomicWrite(p.pendingFile("demo"), Buffer.from('{"version":1}'));
    expect(statSync(p.pendingFile("demo")).mode & 0o777).toBe(0o600);
    expect(() => p.finalizePending(repo, record)).toThrow(/invalid pending/);
  });

  test("pending blocks non apply entrypoints without model or mutation", async () => {
    nativeFiles({ "MEMORY.md": "# M\n" });
    const canonical = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(canonical, ".."), { recursive: true });
    writeFileSync(canonical, "# M\n");
    const record = register();
    p.writeLedger("demo", { "MEMORY.md": Buffer.from("# M\n") });
    const beforeNative = readFileSync(join(native, "MEMORY.md"));
    const beforeLedger = readFileSync(p.ledgerFile("demo"));
    atomicWrite(p.pendingFile("demo"), Buffer.from('{"blocked":true}'));
    const invokeSpy = spyOn(p, "invokeClaude");
    for (const operation of [
      () => p.projectPath(repo, checkout),
      () => p.preview(repo, record, { deletions: [] }),
      async () => p.pull(repo, record),
      () => register(),
    ]) {
      if (operation.constructor.name === "AsyncFunction") {
        await expect(operation()).rejects.toThrow(/pending/);
      } else {
        expect(operation).toThrow(/pending/);
      }
    }
    const report = p.status(repo);
    expect(String((report.projects as Record<string, unknown>[])[0]!.error)).toContain("pending");
    expect(invokeSpy.mock.calls.length).toBe(0);
    invokeSpy.mockRestore();
    expect(readFileSync(join(native, "MEMORY.md"))).toEqual(beforeNative);
    expect(readFileSync(p.ledgerFile("demo"))).toEqual(beforeLedger);
  });

  test("rejected push restores approved trees without touching head or unstaged file", async () => {
    nativeFiles({ "MEMORY.md": "# New\n" });
    const canonical = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(canonical, ".."), { recursive: true });
    writeFileSync(canonical, "# Old\n");
    const record = register();
    p.writeLedger("demo", { "MEMORY.md": Buffer.from("# Old\n") });
    const artifact = p.preview(repo, record, { deletions: [] });
    const head = p.gitRef(repo, "HEAD");
    const manifest = readFileSync(join(repo, "projects/demo/project.toml"));
    const unrelated = join(repo, "notes.txt");
    writeFileSync(unrelated, "leave me\n");
    const hook = join(remote, "hooks", "pre-receive");
    mkdirSync(join(hook, ".."), { recursive: true });
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    await expect(p.apply(repo, record, String(artifact.approval_hash))).rejects.toThrow(/push was rejected/);
    expect(p.gitRef(repo, "HEAD")).toBe(head);
    expect(readFileSync(canonical, "utf-8")).toBe("# Old\n");
    expect(readFileSync(join(native, "MEMORY.md"), "utf-8")).toBe("# New\n");
    expect(readFileSync(join(repo, "projects/demo/project.toml"))).toEqual(manifest);
    expect(readFileSync(unrelated, "utf-8")).toBe("leave me\n");
    expect(existsSync(p.pendingFile("demo"))).toBe(false);
  });

  test("pending recovers after ledger write failure", async () => {
    nativeFiles({ "MEMORY.md": "# New\n" });
    const canonical = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(canonical, ".."), { recursive: true });
    writeFileSync(canonical, "# Old\n");
    const record = register();
    p.writeLedger("demo", { "MEMORY.md": Buffer.from("# Old\n") });
    const artifact = p.preview(repo, record, { deletions: [] });
    const ledgerSpy = spyOn(p, "writeLedger").mockImplementation(() => {
      throw new Error("disk full");
    });
    await expect(p.apply(repo, record, String(artifact.approval_hash))).rejects.toThrow(/disk full/);
    ledgerSpy.mockRestore();
    expect(existsSync(p.pendingFile("demo"))).toBe(true);
    expect(p.finalizePending(repo, record)).toBe(true);
    expect(existsSync(p.pendingFile("demo"))).toBe(false);
    expect(p.readLedger("demo")["MEMORY.md"]!.toString()).toBe("# New\n");
  });

  test("pending version one recovers with former local only native markdown", async () => {
    nativeFiles({ "MEMORY.md": "# New\n" });
    const canonical = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(canonical, ".."), { recursive: true });
    writeFileSync(canonical, "# Old\n");
    const record = register();
    p.writeLedger("demo", { "MEMORY.md": Buffer.from("# Old\n") });
    const artifact = p.preview(repo, record, { deletions: [] });
    const ledgerSpy = spyOn(p, "writeLedger").mockImplementation(() => {
      throw new Error("disk full");
    });
    await expect(p.apply(repo, record, String(artifact.approval_hash))).rejects.toThrow(/disk full/);
    ledgerSpy.mockRestore();
    const extra = Buffer.from("former local note\n");
    nativeFiles({ "legacy-extra.md": extra.toString() });
    const legacy = { ...artifact, version: 1 } as Record<string, unknown>;
    legacy.state = { ...(artifact.state as Record<string, unknown>), native_local_only: ["legacy-extra.md"] };
    delete legacy.approval_hash;
    const approval = p.digest(p.canonicalJson(legacy));
    legacy.approval_hash = approval;
    atomicWrite(p.previewFile("demo", approval), p.canonicalJson(legacy));
    const pending = JSON.parse(readFileSync(p.pendingFile("demo"), "utf-8"));
    pending.approval_hash = approval;
    atomicWrite(p.pendingFile("demo"), p.canonicalJson(pending));
    expect(p.finalizePending(repo, record)).toBe(true);
    expect(existsSync(p.pendingFile("demo"))).toBe(false);
    expect(p.readLedger("demo")["MEMORY.md"]!.toString()).toBe("# New\n");
    expect(readFileSync(join(native, "legacy-extra.md"))).toEqual(extra);
    const nextPreview = p.preview(repo, record, { deletions: [] });
    expect((nextPreview.writes as Record<string, string>)["legacy-extra.md"]).toBe(extra.toString());
  });

  test("pending version two rejects extra native markdown", async () => {
    nativeFiles({ "MEMORY.md": "# New\n" });
    const canonical = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(canonical, ".."), { recursive: true });
    writeFileSync(canonical, "# Old\n");
    const record = register();
    p.writeLedger("demo", { "MEMORY.md": Buffer.from("# Old\n") });
    const artifact = p.preview(repo, record, { deletions: [] });
    const ledgerSpy = spyOn(p, "writeLedger").mockImplementation(() => {
      throw new Error("disk full");
    });
    await expect(p.apply(repo, record, String(artifact.approval_hash))).rejects.toThrow(/disk full/);
    ledgerSpy.mockRestore();
    nativeFiles({ "extra.md": "not approved by v2\n" });
    expect(() => p.finalizePending(repo, record)).toThrow(/cannot safely finalize/);
    expect(existsSync(p.pendingFile("demo"))).toBe(true);
  });

  test("merger schema failure retries from immutable input", () => {
    const fake = join(root, "fake-claude");
    writeFileSync(fake, "#!/bin/sh\n");
    chmodSync(fake, 0o755);
    const requests: Record<string, unknown>[] = [];
    let mergerAttempts = 0;
    const runner = fakeRunner(requests, (payload) => {
      if ("input" in payload) {
        return { schema_version: 1, conflict_id: payload.conflict_id, verdict: "pass", findings: [] };
      }
      mergerAttempts += 1;
      if (mergerAttempts === 1) return { not: "a plan" } as unknown as Record<string, unknown>;
      return { schema_version: 2, conflict_id: payload.conflict_id, ordered_source_ids: null, dispositions: [], contradictions: [] };
    });
    p.mergeConflict("MEMORY.md", Buffer.from("# base\n"), Buffer.from("# left\n"), Buffer.from("# right\n"), fake, "test", runner);
    expect(mergerAttempts).toBe(2);
    expect(requests[0]!.retry_context).toBeNull();
    expect(requests[1]!.retry_context).not.toBeNull();
    const cache = readdirSync(join(state, "verified-merges")).map((name) => join(state, "verified-merges", name))[0]!;
    const cached = JSON.parse(readFileSync(cache, "utf-8"));
    expect(cached.input_hash).toBe(p.digest(p.canonicalJson(requests[0])));
    expect(cached.verifier_input_sha256).toBe(p.digest(p.canonicalJson(requests[requests.length - 1])));
  });

  test("merger timeouts exhaust retries without mutation", () => {
    nativeFiles({ "MEMORY.md": "# Native\n" });
    const canonical = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(canonical, ".."), { recursive: true });
    writeFileSync(canonical, "# Canonical\n");
    const record = register();
    p.writeLedger("demo", { "MEMORY.md": Buffer.from("# Base\n") });
    const fake = join(root, "fake-claude");
    writeFileSync(fake, "#!/bin/sh\n");
    chmodSync(fake, 0o755);
    const before = [readFileSync(canonical), readFileSync(join(native, "MEMORY.md")), readFileSync(p.ledgerFile("demo"))];
    const timeouts: (number | undefined)[] = [];
    const runner = (argv: string[], opts?: { timeout?: number }) => {
      if (argv[argv.length - 1] === "--help") return { returncode: 0, stdout: Buffer.from("--safe-mode\n"), stderr: Buffer.alloc(0) };
      if (argv[argv.length - 1] === "--version") return { returncode: 0, stdout: Buffer.from("fake\n"), stderr: Buffer.alloc(0) };
      if (argv.slice(1).join(" ") === "auth status --json") {
        return { returncode: 0, stdout: Buffer.from('{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}'), stderr: Buffer.alloc(0) };
      }
      timeouts.push(opts?.timeout);
      throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    };
    expect(() => p.preview(repo, record, { deletions: [], claudeBinary: fake, model: "test", runner })).toThrow(/merge retries exhausted/);
    expect(timeouts).toEqual(Array(p.MAX_MERGE_RETRIES).fill(p.CLAUDE_CALL_TIMEOUT_SECONDS));
    expect([readFileSync(canonical), readFileSync(join(native, "MEMORY.md")), readFileSync(p.ledgerFile("demo"))]).toEqual(before);
    const previewsDir = join(state, "previews");
    expect(existsSync(previewsDir) ? readdirSync(previewsDir).filter((n) => n.startsWith("demo-")) : []).toEqual([]);
    const verifiedDir = join(state, "verified-merges");
    expect(existsSync(verifiedDir) ? readdirSync(verifiedDir) : []).toEqual([]);
  });

  test("preview artifact is private and binds complete state", () => {
    nativeFiles({ "MEMORY.md": "# M\n" });
    const record = register();
    const canonical = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(canonical, ".."), { recursive: true });
    writeFileSync(canonical, "# M\n");
    const artifact = p.preview(repo, record, { deletions: [] });
    const path = p.previewFile("demo", String(artifact.approval_hash));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("resolve project unregistered returns null", () => {
    expect(p.resolveProject(repo, checkout)).toBeNull();
  });

  test("resolve project registered returns registration", async () => {
    nativeFiles({ "MEMORY.md": "# M\n" });
    const record = register();
    const canonical = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(canonical, ".."), { recursive: true });
    writeFileSync(canonical, "# M\n");
    const artifact = p.preview(repo, record, { deletions: [] });
    await p.apply(repo, record, String(artifact.approval_hash));
    const reg = p.resolveProject(repo, checkout);
    expect(reg).not.toBeNull();
    expect(reg!.project_id).toBe("demo");
  });

  test("status includes canonical and native memory paths", async () => {
    nativeFiles({ "MEMORY.md": "# M\n" });
    const record = register();
    const canonical = join(repo, "projects/demo/memory/MEMORY.md");
    mkdirSync(join(canonical, ".."), { recursive: true });
    writeFileSync(canonical, "# M\n");
    const artifact = p.preview(repo, record, { deletions: [] });
    await p.apply(repo, record, String(artifact.approval_hash));
    const report = p.status(repo);
    expect((report.projects as Record<string, unknown>[]).length).toBe(1);
    const row = (report.projects as Record<string, unknown>[])[0]!;
    expect(row.project_id).toBe("demo");
    expect(row.canonical_memory).toBe(join(repo, "projects/demo/memory"));
    expect(row.native_memory).toBe(p.absoluteNative(native));
  });
});
