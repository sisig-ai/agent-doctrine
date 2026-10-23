#!/usr/bin/env bun
/**
 * Merge the CLIProxyAPI custom provider into the global OpenCode config.
 *
 * OpenCode V2 keeps providers under `providers`. This script edits only
 * `providers.cliproxyapi`, using a JSONC-aware editor so comments and unrelated
 * settings survive. It never writes secret values: the API key is an
 * `{env:CLIPROXY_API_KEY}` reference. When `CLIPROXY_BASE_URL` or
 * `CLIPROXY_API_KEY` is absent, the managed provider is removed. Invalid JSONC
 * fails without changing the file.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { applyEdits, findNodeAtLocation, modify, parse, parseTree, printParseErrorCode, type ParseError } from "jsonc-parser";
import { OPENCODE_TARGET, opencodeConfigPath } from "./wire-opencode-mcp.ts";

/** The only provider name this merger owns. */
export const MANAGED_PROVIDER = "cliproxyapi";

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: "\n" } as const;

export interface ProviderModel {
  name: string;
  limit: { context: number; output: number };
  capabilities: { tools: boolean; input: string[]; output: string[] };
}

export interface Provider {
  name: string;
  package: string;
  settings: { baseURL: string; apiKey: string };
  models: Record<string, ProviderModel>;
}

/** The Claude and OpenAI chat models exposed by the local CLIProxyAPI, verified against GET /v1/models. */
export function providerModels(): Record<string, ProviderModel> {
  const model = (name: string, output: number): ProviderModel => ({
    name,
    limit: { context: 200000, output },
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
  });
  return {
    "claude-opus-5-5": model("Claude Opus 5.5", 64000),
    "claude-opus-5": model("Claude Opus 5", 64000),
    "claude-opus-4-8": model("Claude Opus 4.8", 64000),
    "claude-opus-4-7": model("Claude Opus 4.7", 64000),
    "claude-opus-4-6": model("Claude Opus 4.6", 64000),
    "claude-opus-4-5-20251101": model("Claude Opus 4.5", 64000),
    "claude-opus-4-1-20250805": model("Claude Opus 4.1", 32000),
    "claude-opus-4-20250514": model("Claude Opus 4", 32000),
    "claude-sonnet-5-5": model("Claude Sonnet 5.5", 64000),
    "claude-sonnet-5": model("Claude Sonnet 5", 64000),
    "claude-sonnet-4-6": model("Claude Sonnet 4.6", 64000),
    "claude-sonnet-4-5-20250929": model("Claude Sonnet 4.5", 64000),
    "claude-sonnet-4-20250514": model("Claude Sonnet 4", 64000),
    "claude-fable-5-1": model("Claude Fable 5.1", 64000),
    "claude-fable-5": model("Claude Fable 5", 64000),
    "claude-haiku-4-5-20251001": model("Claude Haiku 4.5", 64000),
    "claude-3-7-sonnet-20250219": model("Claude 3.7 Sonnet", 64000),
    "claude-3-5-haiku-20241022": model("Claude 3.5 Haiku", 8192),
    "codex-auto-review": model("Codex Auto Review", 64000),
    "gpt-5.5": model("GPT-5.5", 64000),
    "gpt-5.6-luna": model("GPT-5.6 Luna", 64000),
    "gpt-5.6-sol": model("GPT-5.6 Sol", 64000),
    "gpt-5.6-terra": model("GPT-5.6 Terra", 64000),
    "gpt-6-astra": model("GPT-6 Astra", 64000),
    "gpt-6-luna": model("GPT-6 Luna", 64000),
    "gpt-6-sol": model("GPT-6 Sol", 64000),
    "gpt-6.1-sol": model("GPT-6.1 Sol", 64000),
  };
}

/** The provider doctrine manages, given the environment; null when unconfigured. */
export function desiredProvider(env: NodeJS.ProcessEnv = process.env): Provider | null {
  const baseURL = env.CLIPROXY_BASE_URL?.trim();
  const apiKey = env.CLIPROXY_API_KEY?.trim();
  if (!baseURL || !apiKey) return null;
  return {
    name: "CLIProxyAPI (Claude and ChatGPT subscriptions)",
    package: "@opencode/ai/providers/openai-compatible",
    settings: { baseURL, apiKey: "{env:CLIPROXY_API_KEY}" },
    models: providerModels(),
  };
}

/**
 * Merge the provider into JSONC text. Throws before returning anything when the
 * text is not valid JSONC, so callers can fail without touching the file. A null
 * provider deletes `providers.cliproxyapi`; unrelated providers are preserved.
 */
export function mergeProvider(text: string, provider: Provider | null): string {
  const source = text.trim() ? text : "{}";
  const errors: ParseError[] = [];
  parse(source, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) {
    const detail = errors
      .map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`)
      .join(", ");
    throw new Error(`invalid JSONC: ${detail}`);
  }
  let out = source;
  if (!provider) {
    const tree = parseTree(out, [], { allowTrailingComma: true, disallowComments: false });
    if (tree && findNodeAtLocation(tree, ["providers", MANAGED_PROVIDER])) {
      out = applyEdits(out, modify(out, ["providers", MANAGED_PROVIDER], undefined, { formattingOptions: FORMATTING }));
    }
  } else {
    out = applyEdits(out, modify(out, ["providers", MANAGED_PROVIDER], provider, { formattingOptions: FORMATTING }));
  }
  return out.endsWith("\n") ? out : `${out}\n`;
}

/** Apply the merge to the resolved config file. Returns the path and wired provider name. */
export function wire(
  env: NodeJS.ProcessEnv = process.env,
  target: string = OPENCODE_TARGET,
): { path: string; provider: string | null } {
  const path = opencodeConfigPath(target);
  const current = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const provider = desiredProvider(env);
  const merged = mergeProvider(current, provider);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, merged);
  return { path, provider: provider ? MANAGED_PROVIDER : null };
}

if (import.meta.main) {
  const { path, provider } = wire();
  if (provider) {
    console.log(`wired opencode provider (${provider}) -> ${path}`);
  } else {
    console.log(`WARN: CLIPROXY_BASE_URL or CLIPROXY_API_KEY missing; ${MANAGED_PROVIDER} provider removed -> ${path}`);
  }
}
