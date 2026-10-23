import { describe, expect, test } from "bun:test";
import {
  MEMORY_INDEX_HEADER,
  ProjectMemoryError,
  mergeMemoryIndex,
  parseMemoryIndex,
  renderMemoryIndex,
  tryParseMemoryIndex,
} from "../src/project-memory.ts";

function index(...lines: string[]): Buffer {
  const body = lines.map((l) => `${l}\n\n`).join("");
  return Buffer.from(`${MEMORY_INDEX_HEADER}\n\n${body}`.replace(/\n+$/, "\n"));
}

const a = "- [A](a.md) — alpha";
const a2 = "- [A](a.md) — alpha-v2";
const b = "- [B](b.md) — beta";
const c = "- [C](c.md) — gamma";

describe("memory index parse", () => {
  test("parses recognized index and rejects freeform", () => {
    const parsed = parseMemoryIndex(index(a, b));
    expect(parsed.order).toEqual(["a.md", "b.md"]);
    expect(tryParseMemoryIndex(Buffer.from("# M\n"))).toBeNull();
    expect(() => parseMemoryIndex(Buffer.from("# Memory Index\n\nnot an entry\n"))).toThrow(ProjectMemoryError);
    expect(() => parseMemoryIndex(index(a, a))).toThrow(/duplicate/);
  });

  test("round-trips render", () => {
    const buf = index(a, b);
    const parsed = parseMemoryIndex(buf);
    expect(renderMemoryIndex(parsed.order, parsed.entries).equals(buf)).toBe(true);
  });
});

describe("mergeMemoryIndex", () => {
  test("unions different-key additions without claude", () => {
    const base = index(a);
    const canonical = index(a, b);
    const native = index(a, c);
    const [merged, audit] = mergeMemoryIndex(base, canonical, native);
    const parsed = parseMemoryIndex(merged);
    expect(parsed.order).toEqual(["a.md", "c.md", "b.md"]);
    expect(parsed.entries.get("a.md")).toBe(a);
    expect(parsed.entries.get("b.md")).toBe(b);
    expect(parsed.entries.get("c.md")).toBe(c);
    expect(audit.strategy).toBe("keyed-memory-index");
    expect(audit.decisions).toEqual({
      "a.md": "take_canonical",
      "c.md": "take_native",
      "b.md": "take_canonical",
    });
  });

  test("fast-forwards one-sided blurb edit", () => {
    const base = index(a, b);
    const canonical = index(a, b);
    const native = index(a2, b);
    const [merged] = mergeMemoryIndex(base, canonical, native);
    expect(parseMemoryIndex(merged).entries.get("a.md")).toBe(a2);
  });

  test("fails closed on same-key concurrent edit", () => {
    const base = index(a);
    const canonical = index(a2);
    const native = index("- [A](a.md) — other");
    expect(() => mergeMemoryIndex(base, canonical, native)).toThrow(/memory index conflict on a\.md/);
  });

  test("fails closed on delete-vs-edit", () => {
    const base = index(a, b);
    const canonical = index(a2, b);
    const native = index(b);
    expect(() => mergeMemoryIndex(base, canonical, native)).toThrow(/memory index conflict on a\.md/);
  });

  test("shared delete drops the key", () => {
    const base = index(a, b);
    const canonical = index(b);
    const native = index(b);
    const [merged] = mergeMemoryIndex(base, canonical, native);
    expect(parseMemoryIndex(merged).order).toEqual(["b.md"]);
  });

  test("absent base unions both sides and conflicts on same-key add", () => {
    const [merged] = mergeMemoryIndex(null, index(a), index(b));
    expect(parseMemoryIndex(merged).order).toEqual(["b.md", "a.md"]);
    expect(() => mergeMemoryIndex(null, index(a), index(a2))).toThrow(/conflict/);
  });
});
