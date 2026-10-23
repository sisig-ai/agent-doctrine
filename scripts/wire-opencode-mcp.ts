#!/usr/bin/env bun
/**
 * Merge the doctrine MCP servers into the global OpenCode config.
 *
 * OpenCode V2 keeps MCP servers under `mcp.servers`. This script edits only
 * `mcp.servers.semble`, `mcp.servers.honcho`, and `mcp.servers.porch`, using a
 * JSONC-aware editor so comments and unrelated settings survive. It never writes
 * secret values: credentials are `{env:...}` references. When a required
 * environment variable is absent, that server is omitted. Invalid JSONC fails
 * without changing the file.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { applyEdits, findNodeAtLocation, modify, parse, parseTree, printParseErrorCode, type ParseError } from "jsonc-parser";

export const OPENCODE_TARGET = resolve(process.env.OPENCODE_MD_TARGET ?? join(homedir(), ".config", "opencode"));

export type McpServer = Record<string, unknown>;

/**
 * The only server names this merger owns. A managed name that is absent from
 * the desired set is removed from the config; unrelated servers are untouched.
 */
export const MANAGED_SERVERS = ["semble", "honcho", "porch"] as const;

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: "\n" } as const;

/** Resolve the config file to edit, preferring an existing file and JSONC for new ones. */
export function opencodeConfigPath(target: string = OPENCODE_TARGET): string {
  if (process.env.OPENCODE_CONFIG_FILE) return resolve(process.env.OPENCODE_CONFIG_FILE);
  const jsonc = join(target, "opencode.jsonc");
  const json = join(target, "opencode.json");
  if (existsSync(jsonc)) return jsonc;
  if (existsSync(json)) return json;
  return jsonc;
}

/** The servers doctrine manages, given the environment. */
export function desiredServers(env: NodeJS.ProcessEnv = process.env): Record<string, McpServer> {
  const servers: Record<string, McpServer> = {
    semble: { type: "local", command: ["semble"] },
  };

  const honchoKey = env.HONCHO_API_KEY?.trim();
  const honchoWorkspace = env.HONCHO_WORKSPACE?.trim();
  if (honchoKey && honchoWorkspace) {
    const peer = env.HONCHO_PEER_NAME?.trim();
    servers.honcho = {
      type: "remote",
      url: "https://mcp.honcho.dev",
      oauth: false,
      headers: {
        Authorization: "Bearer {env:HONCHO_API_KEY}",
        "X-Honcho-User-Name": peer ? "{env:HONCHO_PEER_NAME}" : "agent",
        "X-Honcho-Workspace-ID": "{env:HONCHO_WORKSPACE}",
      },
    };
  }

  const porchToken = env.PORCH_MCP_TOKEN?.trim();
  if (porchToken) {
    servers.porch = {
      type: "remote",
      url: "https://porch.sh/mcp",
      oauth: false,
      headers: { Authorization: "Bearer {env:PORCH_MCP_TOKEN}" },
    };
  }

  return servers;
}

/**
 * Merge servers into JSONC text. Throws before returning anything when the text
 * is not valid JSONC, so callers can fail without touching the file.
 */
export function mergeOpencodeMcp(text: string, servers: Record<string, McpServer>): string {
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
  // Drop managed servers that are no longer desired (for example, a previously
  // wired honcho or porch whose environment variables are now absent). Passing
  // `undefined` deletes the property; all other servers are preserved.
  for (const name of MANAGED_SERVERS) {
    if (name in servers) continue;
    const tree = parseTree(out, [], { allowTrailingComma: true, disallowComments: false });
    if (!tree || !findNodeAtLocation(tree, ["mcp", "servers", name])) continue;
    out = applyEdits(out, modify(out, ["mcp", "servers", name], undefined, { formattingOptions: FORMATTING }));
  }
  for (const [name, server] of Object.entries(servers)) {
    const edits = modify(out, ["mcp", "servers", name], server, { formattingOptions: FORMATTING });
    out = applyEdits(out, edits);
  }
  return out.endsWith("\n") ? out : `${out}\n`;
}

/** Apply the merge to the resolved config file. Returns the path and managed server names. */
export function wire(
  env: NodeJS.ProcessEnv = process.env,
  target: string = OPENCODE_TARGET,
): { path: string; servers: string[] } {
  const path = opencodeConfigPath(target);
  const current = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const servers = desiredServers(env);
  const merged = mergeOpencodeMcp(current, servers);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, merged);
  return { path, servers: Object.keys(servers) };
}

if (import.meta.main) {
  const { path, servers } = wire();
  console.log(`wired opencode mcp (${servers.join(", ")}) -> ${path}`);
  if (!servers.includes("honcho")) {
    console.log("WARN: HONCHO_API_KEY or HONCHO_WORKSPACE missing; honcho mcp skipped");
  }
  if (!servers.includes("porch")) {
    console.log("WARN: PORCH_MCP_TOKEN missing; porch mcp skipped");
  }
}
