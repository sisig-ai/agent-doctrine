import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createNote } from "../scripts/handoff.ts";
import handoff, {
  checkDelegation,
  registerHandoffGuard,
  spawnEnforce,
} from "../opencode/plugins/handoff/index.ts";

const REPO_CORE = join(import.meta.dir, "..", "scripts", "handoff.ts");

function harness() {
  const hooks = new Map<string, (event: any) => unknown>();
  const ctx = {
    tool: {
      hook: (name: string, callback: (event: any) => unknown) => {
        hooks.set(name, callback);
        return Promise.resolve();
      },
    },
  };
  return { ctx, hooks };
}

const ORIGINAL_DISABLE = process.env.HANDOFF_GUARD_DISABLE;
afterEach(() => {
  if (ORIGINAL_DISABLE === undefined) delete process.env.HANDOFF_GUARD_DISABLE;
  else process.env.HANDOFF_GUARD_DISABLE = ORIGINAL_DISABLE;
});

describe("handoff guard", () => {
  test("declares the plugin id", () => {
    expect(handoff.id).toBe("handoff");
  });

  test("ignores non-delegation tools", async () => {
    const h = harness();
    await registerHandoffGuard(h.ctx, { verify: () => ({ ok: false, reason: "nope" }) });
    const callback = h.hooks.get("execute.before")!;
    expect(() => callback({ tool: "read", input: { filePath: "/x" } })).not.toThrow();
  });

  test("intercepts the subagent tool", async () => {
    const h = harness();
    await registerHandoffGuard(h.ctx, { verify: () => ({ ok: false, reason: "no pointer" }) });
    const callback = h.hooks.get("execute.before")!;
    expect(() => callback({ tool: "subagent", input: { prompt: "plain task" } })).toThrow("delegation rejected");
  });

  test("also intercepts the task alias", async () => {
    const h = harness();
    await registerHandoffGuard(h.ctx, { verify: () => ({ ok: true }) });
    const callback = h.hooks.get("execute.before")!;
    expect(() => callback({ tool: "task", input: { prompt: "x" } })).not.toThrow();
  });

  test("rejects a delegation with no prompt", () => {
    expect(() => checkDelegation({}, { verify: () => ({ ok: true }) })).toThrow("no prompt");
  });

  test("passes when the verifier accepts", async () => {
    const h = harness();
    await registerHandoffGuard(h.ctx, { verify: () => ({ ok: true }) });
    const callback = h.hooks.get("execute.before")!;
    expect(() => callback({ tool: "subagent", input: { prompt: "x" } })).not.toThrow();
  });

  test("disables entirely when the recursion marker is set", async () => {
    process.env.HANDOFF_GUARD_DISABLE = "1";
    const h = harness();
    registerHandoffGuard(h.ctx, { verify: () => ({ ok: false }) });
    expect(h.hooks.size).toBe(0);
  });
});

describe("spawnEnforce against the real core", () => {
  test("accepts one valid pointer and rejects zero, two, and stale", () => {
    const dir = mkdtempSync(join(tmpdir(), "handoff-guard-"));
    const note = join(dir, "note.md");
    createNote(note, { blocks: [{ kind: "exact", text: "body" }] }, { harness: "opencode", model: "m", executor: (p) => p });
    const verify = spawnEnforce(REPO_CORE);
    expect(verify(`work\nhandoff: {"note":"${note}"}`).ok).toBe(true);
    expect(verify("plain task").ok).toBe(false);
    expect(verify(`handoff: {"note":"${note}"}\nhandoff: {"note":"${note}"}`).ok).toBe(false);
    writeFileSync(note, "tampered\n");
    const stale = verify(`work\nhandoff: {"note":"${note}"}`);
    expect(stale.ok).toBe(false);
    expect(stale.reason).toContain("stale");
  });
});
