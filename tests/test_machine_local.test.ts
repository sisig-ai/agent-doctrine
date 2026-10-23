import { describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { tmpdir } from "os";
import {
  MachineLocalError,
  defaultMachineLocalPaths,
  machineLocalStatus,
  reconcileMachineLocal,
  type MachineLocalPaths,
} from "../src/machine-local.ts";

function fixture(): MachineLocalPaths & { root: string } {
  const root = mkdtempSync(join(tmpdir(), "machine-local-"));
  const claude = join(root, "claude");
  const codex = join(root, "codex");
  const cursor = join(root, "cursor");
  const opencode = join(root, "opencode");
  const cacheDir = join(root, "repo", ".local");
  for (const dir of [claude, codex, cursor, opencode, cacheDir]) mkdirSync(dir, { recursive: true });
  return {
    root,
    cache: join(cacheDir, "LOCAL.md"),
    canonical: join(claude, "LOCAL.md"),
    mirrors: [
      { label: "codex", path: join(codex, "LOCAL.md") },
      { label: "cursor", path: join(cursor, "LOCAL.md") },
      { label: "opencode", path: join(opencode, "LOCAL.md") },
    ],
  };
}

function readResolved(path: string): string {
  return readFileSync(path, "utf-8");
}

function linkTarget(path: string): string {
  return resolve(join(path, ".."), readlinkSync(path));
}

describe("reconcileMachineLocal", () => {
  test("promotes canonical content to mirrors and cache", () => {
    const paths = fixture();
    writeFileSync(paths.canonical, "# local\n");
    const result = reconcileMachineLocal(paths);
    expect(result.content).toBe("# local\n");
    expect(readResolved(paths.canonical)).toBe("# local\n");
    expect(readResolved(paths.cache)).toBe("# local\n");
    expect(lstatSync(paths.canonical).isSymbolicLink()).toBe(false);
    for (const { path: mirror } of paths.mirrors) {
      expect(lstatSync(mirror).isSymbolicLink()).toBe(true);
      expect(linkTarget(mirror)).toBe(resolve(paths.canonical));
      expect(readResolved(mirror)).toBe("# local\n");
    }
  });

  test("promotes mirror-only content into canonical", () => {
    const paths = fixture();
    writeFileSync(paths.mirrors[1]!.path, "# from cursor\n");
    reconcileMachineLocal(paths);
    expect(readResolved(paths.canonical)).toBe("# from cursor\n");
    expect(lstatSync(paths.canonical).isSymbolicLink()).toBe(false);
    expect(lstatSync(paths.mirrors[1]!.path).isSymbolicLink()).toBe(true);
    expect(linkTarget(paths.mirrors[1]!.path)).toBe(resolve(paths.canonical));
  });

  test("promotes cache-only content into agent homes", () => {
    const paths = fixture();
    writeFileSync(paths.cache, "# from cache\n");
    reconcileMachineLocal(paths);
    expect(readResolved(paths.canonical)).toBe("# from cache\n");
    expect(readResolved(paths.mirrors[0]!.path)).toBe("# from cache\n");
  });

  test("is idempotent when already reconciled", () => {
    const paths = fixture();
    writeFileSync(paths.canonical, "# once\n");
    reconcileMachineLocal(paths);
    reconcileMachineLocal(paths);
    expect(readResolved(paths.canonical)).toBe("# once\n");
    expect(linkTarget(paths.mirrors[0]!.path)).toBe(resolve(paths.canonical));
  });

  test("cache follows agreeing homes", () => {
    const paths = fixture();
    writeFileSync(paths.canonical, "# a\n");
    writeFileSync(paths.cache, "# old\n");
    reconcileMachineLocal(paths);
    expect(readResolved(paths.canonical)).toBe("# a\n");
    expect(readResolved(paths.cache)).toBe("# a\n");
  });

  test("arbitrates divergent homes and backs up inputs", () => {
    const paths = fixture();
    writeFileSync(paths.canonical, "# a\n");
    writeFileSync(paths.mirrors[0]!.path, "# b\n");
    let seen: { label: string; path: string; content: string }[] = [];
    reconcileMachineLocal(paths, (v) => {
      seen = v;
      return "# a\n# b\n";
    });
    expect(seen).toHaveLength(2);
    expect(seen.map((v) => v.label).sort()).toEqual(["claude", "codex"]);
    const merged = "# a\n# b\n";
    expect(readResolved(paths.canonical)).toBe(merged);
    expect(readResolved(paths.cache)).toBe(merged);
    for (const { path: mirror } of paths.mirrors) {
      expect(readResolved(mirror)).toBe(merged);
    }
    const conflictsDir = join(dirname(paths.cache), "conflicts");
    expect(existsSync(conflictsDir)).toBe(true);
    const files = readdirSync(conflictsDir);
    expect(files).toHaveLength(2);
    const contents = files.map((f) => readFileSync(join(conflictsDir, f), "utf-8")).sort();
    expect(contents).toEqual(["# a\n", "# b\n"]);
  });

  test("arbiter failure is loud and writes nothing", () => {
    const paths = fixture();
    writeFileSync(paths.canonical, "# a\n");
    writeFileSync(paths.mirrors[0]!.path, "# b\n");
    expect(() =>
      reconcileMachineLocal(paths, () => {
        throw new MachineLocalError("arbiter down");
      }),
    ).toThrow(MachineLocalError);
    expect(readResolved(paths.canonical)).toBe("# a\n");
    expect(readResolved(paths.mirrors[0]!.path)).toBe("# b\n");
    expect(existsSync(paths.cache)).toBe(false);
    expect(existsSync(join(dirname(paths.cache), "conflicts"))).toBe(false);
  });

  test("arbiter that drops a line is loud and writes nothing", () => {
    const paths = fixture();
    writeFileSync(paths.canonical, "# a\n");
    writeFileSync(paths.mirrors[0]!.path, "# b\n");
    expect(() => reconcileMachineLocal(paths, () => "# a\n")).toThrow(
      /dropped a line from .*: # b/,
    );
    expect(readResolved(paths.canonical)).toBe("# a\n");
    expect(readResolved(paths.mirrors[0]!.path)).toBe("# b\n");
    expect(existsSync(paths.cache)).toBe(false);
    expect(existsSync(join(dirname(paths.cache), "conflicts"))).toBe(false);
  });

  test("rewrites wrong symlink targets when content matches", () => {
    const paths = fixture();
    const other = join(paths.root, "other.md");
    writeFileSync(other, "# same\n");
    writeFileSync(paths.canonical, "# same\n");
    symlinkSync(other, paths.mirrors[0]!.path);
    reconcileMachineLocal(paths);
    expect(linkTarget(paths.mirrors[0]!.path)).toBe(resolve(paths.canonical));
  });

  test("returns empty when nothing present", () => {
    const paths = fixture();
    expect(reconcileMachineLocal(paths)).toEqual({ content: null, sources: [] });
  });

  test("status reports missing present and symlink rows", () => {
    const paths = fixture();
    writeFileSync(paths.canonical, "# status\n");
    reconcileMachineLocal(paths);
    const status = machineLocalStatus(paths);
    expect(status).toContain("claude: present");
    expect(status).toContain("codex: symlink ->");
    expect(status).toContain("cursor: symlink ->");
    expect(status).toContain("opencode: symlink ->");
    expect(status).toContain("repo-cache: present");
  });

  test("default paths expose four named mirrors", () => {
    const paths = defaultMachineLocalPaths();
    expect(paths.mirrors.map((m) => m.label)).toEqual(["codex", "cursor", "opencode", "grok", "muse"]);
    for (const mirror of paths.mirrors) expect(mirror.path.endsWith("LOCAL.md")).toBe(true);
  });
});
