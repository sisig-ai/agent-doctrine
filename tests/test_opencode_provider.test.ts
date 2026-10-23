import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { desiredProvider, mergeProvider, providerModels, wire, MANAGED_PROVIDER } from "../scripts/wire-opencode-provider.ts";

const ENV = {
  CLIPROXY_BASE_URL: "http://127.0.0.1:8317/v1",
  CLIPROXY_API_KEY: "sk-cpa-super-secret",
} as NodeJS.ProcessEnv;

describe("opencode cliproxyapi provider", () => {
  test("exposes the 27-model Claude and OpenAI map with limits and capabilities", () => {
    const models = providerModels();
    expect(Object.keys(models)).toHaveLength(27);
    expect(models["claude-opus-5-5"]).toEqual({
      name: "Claude Opus 5.5",
      limit: { context: 200000, output: 64000 },
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    });
    expect(models["claude-opus-4-1-20250805"].limit.output).toBe(32000);
    expect(models["claude-3-5-haiku-20241022"].limit.output).toBe(8192);
    expect(models["gpt-5.6-sol"]).toEqual({
      name: "GPT-5.6 Sol",
      limit: { context: 200000, output: 64000 },
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    });
  });

  test("desiredProvider needs both base url and key", () => {
    expect(desiredProvider({ CLIPROXY_BASE_URL: "http://x/v1" } as NodeJS.ProcessEnv)).toBeNull();
    expect(desiredProvider({ CLIPROXY_API_KEY: "k" } as NodeJS.ProcessEnv)).toBeNull();
    expect(desiredProvider({} as NodeJS.ProcessEnv)).toBeNull();
    const provider = desiredProvider(ENV);
    expect(provider?.package).toBe("@opencode/ai/providers/openai-compatible");
    expect(provider?.settings).toEqual({
      baseURL: "http://127.0.0.1:8317/v1",
      apiKey: "{env:CLIPROXY_API_KEY}",
    });
  });

  test("adds the provider, keeps comments and unrelated settings, never writes the secret", () => {
    const source = `{
  // keep this comment
  "$schema": "https://opencode.ai/config.json",
  "model": "openai/gpt-5.6-sol#medium",
  "providers": {
    "existing": { "name": "Existing" }
  }
}
`;
    const merged = mergeProvider(source, desiredProvider(ENV));
    expect(merged).toContain("// keep this comment");
    expect(merged).toContain('"existing"');
    expect(merged).toContain('"model": "openai/gpt-5.6-sol#medium"');
    expect(merged).toContain(`"${MANAGED_PROVIDER}"`);
    expect(merged).toContain("{env:CLIPROXY_API_KEY}");
    expect(merged).not.toContain("sk-cpa-super-secret");
  });

  test("removes the provider when the env is absent and preserves unrelated providers", () => {
    const source = `{
  // keep this comment
  "providers": {
    "cliproxyapi": { "name": "CLIProxyAPI (Claude and ChatGPT subscriptions)" },
    "keepme": { "name": "Keep me" }
  }
}
`;
    const merged = mergeProvider(source, desiredProvider({} as NodeJS.ProcessEnv));
    expect(merged).toContain("// keep this comment");
    expect(merged).toContain('"keepme"');
    expect(merged).not.toContain('"cliproxyapi"');
    // Idempotent: a second pass over the merged text changes nothing.
    expect(mergeProvider(merged, desiredProvider({} as NodeJS.ProcessEnv))).toBe(merged);
  });

  test("merge is idempotent when the provider is present", () => {
    const first = mergeProvider("{}", desiredProvider(ENV));
    expect(mergeProvider(first, desiredProvider(ENV))).toBe(first);
  });

  test("fails on invalid JSONC and leaves the file unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-provider-bad-"));
    const target = join(root, "opencode.jsonc");
    const broken = `{ "providers": { `;
    writeFileSync(target, broken);
    expect(() => wire(ENV, root)).toThrow(/invalid JSONC/);
    expect(readFileSync(target, "utf-8")).toBe(broken);
  });

  test("wire creates the config with the provider and is idempotent", () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-provider-new-"));
    const result = wire(ENV, root);
    expect(result.path).toBe(join(root, "opencode.jsonc"));
    expect(result.provider).toBe(MANAGED_PROVIDER);
    const written = JSON.parse(readFileSync(result.path, "utf-8"));
    expect(written.providers[MANAGED_PROVIDER].settings.apiKey).toBe("{env:CLIPROXY_API_KEY}");
    const first = readFileSync(result.path, "utf-8");
    wire(ENV, root);
    expect(readFileSync(result.path, "utf-8")).toBe(first);
  });

  test("wire removes a stale provider when the env is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-provider-stale-"));
    writeFileSync(
      join(root, "opencode.jsonc"),
      `{
  "providers": {
    "cliproxyapi": { "name": "CLIProxyAPI (Claude and ChatGPT subscriptions)" },
    "keepme": { "name": "Keep me" }
  }
}
`,
    );
    const result = wire({} as NodeJS.ProcessEnv, root);
    expect(result.provider).toBeNull();
    const written = readFileSync(result.path, "utf-8");
    expect(written).toContain('"keepme"');
    expect(written).not.toContain('"cliproxyapi"');
  });
});
