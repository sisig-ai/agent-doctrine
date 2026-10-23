import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { deployHandoffCore, handoffCapabilities, installHandoffLocal } from "../src/host-hooks.ts";

function tempTarget(): string {
  return mkdtempSync(join(tmpdir(), "handoff-install-"));
}

const REPO_CORE = join(import.meta.dir, "..", "scripts", "handoff.ts");

describe("deployHandoffCore", () => {
  test("copies the self-contained core to the target", () => {
    const target = tempTarget();
    deployHandoffCore(target);
    expect(readFileSync(join(target, "handoff.ts"), "utf-8")).toBe(readFileSync(REPO_CORE, "utf-8"));
  });

  test("is idempotent", () => {
    const target = tempTarget();
    deployHandoffCore(target);
    const first = readFileSync(join(target, "handoff.ts"), "utf-8");
    deployHandoffCore(target);
    expect(readFileSync(join(target, "handoff.ts"), "utf-8")).toBe(first);
  });
});

describe("installHandoffLocal", () => {
  test("refuses without the machine-local override", () => {
    const target = tempTarget();
    expect(() => installHandoffLocal(target, join(target, "LOCAL.md"))).toThrow("does not declare");
  });

  test("installs the core and plugin when the override is present", () => {
    const target = tempTarget();
    writeFileSync(join(target, "LOCAL.md"), "this machine does not require porch\n");
    installHandoffLocal(target, join(target, "LOCAL.md"));
    expect(existsSync(join(target, "handoff.ts"))).toBe(true);
    expect(existsSync(join(target, "plugins", "handoff", "index.ts"))).toBe(true);
  });
});

describe("handoffCapabilities", () => {
  test("reports opencode installed after core and plugin deploy", () => {
    const claude = tempTarget();
    const opencode = tempTarget();
    deployHandoffCore(claude);
    deployHandoffCore(opencode);
    mkdirSync(join(opencode, "plugins", "handoff"), { recursive: true });
    writeFileSync(join(opencode, "plugins", "handoff", "index.ts"), "export default {}\n");
    const caps = handoffCapabilities({ claude, opencode });
    expect(caps.find((c) => c.host === "opencode")!.enforcement).toBe("installed");
    expect(caps.find((c) => c.host === "claude")!.enforcement).toBe("compressor-only");
  });

  test("reports unsupported when nothing is installed", () => {
    const claude = tempTarget();
    const opencode = tempTarget();
    const caps = handoffCapabilities({ claude, opencode });
    expect(caps.find((c) => c.host === "opencode")!.enforcement).toBe("unsupported");
    expect(caps.find((c) => c.host === "claude")!.enforcement).toBe("unsupported");
    for (const host of ["codex", "cursor", "amp"]) {
      expect(caps.find((c) => c.host === host)!.enforcement).toBe("unsupported");
    }
  });

  test("opencode needs both plugin and core to count as installed", () => {
    const opencode = tempTarget();
    mkdirSync(join(opencode, "plugins", "handoff"), { recursive: true });
    writeFileSync(join(opencode, "plugins", "handoff", "index.ts"), "export default {}\n");
    expect(handoffCapabilities({ opencode }).find((c) => c.host === "opencode")!.enforcement).toBe("unsupported");
    expect(existsSync(join(opencode, "handoff.ts"))).toBe(false);
  });
});
