# Machine setup

For doctrine only, follow the README first. This optional full bootstrap installs tools, changes agent homes, configures external services, and starts a network service. Use your own accounts and review the changes before running it. A public upstream is not a destination for private memory or machine configuration.


Use this file on a **new machine** after cloning this repository. An agent should read it fully, export the required secrets, run the scripts, fix any interactive auth gaps, and report smoke-test results.

Canonical clone path (recommended, matches `sync.sh` defaults):

```bash
git clone https://github.com/sisig-ai/agent-doctrine.git ~/.claude/.claude-md-repo
cd ~/.claude/.claude-md-repo
```

You may clone anywhere; set `CLAUDE_MD_DIR` to the repo root before running scripts if not using the default path.

## Required secrets (environment variables)

Never commit these values. Do **not** prefix tokens with `Bearer` in env vars; scripts add `Bearer` in HTTP headers.

| Variable | Purpose |
| --- | --- |
| `OPENCODE_SERVER_PASSWORD` | Required strong password for the OpenCode service; no default |
| `HONCHO_API_KEY` | Honcho MCP/API key from [app.honcho.dev](https://app.honcho.dev) |
| `HONCHO_WORKSPACE` | Honcho workspace id (your workspace in the console) |
| `HONCHO_PEER_NAME` | Honcho peer name for this machine (required by full setup; low-level wiring defaults to `agent`) |
| `PORCH_MCP_TOKEN` | Porch MCP bearer token for `https://porch.sh/mcp` |
| `CLIPROXY_BASE_URL` | Optional. CLIProxyAPI base URL for the OpenCode `cliproxyapi` provider. No default; set your own proxy URL to enable it |
| `CLIPROXY_API_KEY` | Optional. CLIProxyAPI key for the OpenCode `cliproxyapi` provider; written to config as `{env:CLIPROXY_API_KEY}`, never as a literal |

Export them in the shell (or load from your password manager) before running setup:

```bash
export OPENCODE_SERVER_PASSWORD='…'
export HONCHO_API_KEY='…'
export HONCHO_WORKSPACE='…'
export HONCHO_PEER_NAME='agent'
export PORCH_MCP_TOKEN='…'
export CLIPROXY_API_KEY='…'
```

## What setup does

1. Installs **bun**, **uv**, **semble**, and the **claude**, **codex**, **cursor-agent**, and **opencode** CLIs if missing.
2. Runs **doctrine sync** (`sync.sh install`, `pull-all`) so `~/.claude`, `~/.codex`, `~/.cursor`, and `~/.config/opencode` use this repo as source of truth (`CLAUDE.md`, `AGENTS.md`, `TASTE.md`, `TENETS.md`, `HANDOFFS.md`, generated host doctrine, agents, skills).
3. Wires **MCP** for **honcho**, **semble**, and **porch** on Cursor and Claude (`~/.cursor/mcp.json`, `~/.claude/settings.json`), writes `~/.config/porch/mcp.env` (mode 600), merges Codex `[mcp_servers.*]` into `~/.codex/config.toml`, merges OpenCode `mcp.servers` into `~/.config/opencode/opencode.json(c)` with `scripts/wire-opencode-mcp.ts`, merges the OpenCode `cliproxyapi` provider with `scripts/wire-opencode-provider.ts`, and writes `~/.honcho/config.json`.
4. Starts **OpenCode V2 in service mode** on `0.0.0.0:4096` (password from `OPENCODE_SERVER_PASSWORD`, required, no default) so hosts match the image. The `cliproxyapi` provider is disabled unless a URL and key are supplied.
5. Runs **smoke tests** (Semble CLI, Honcho REST list, Porch `tools/list`, OpenCode config and `opencode mcp list`).

## Run setup (agent executes)

```bash
cd "${CLAUDE_MD_DIR:-$HOME/.claude/.claude-md-repo}"
chmod +x scripts/machine-setup.sh scripts/mcp-smoke.sh
./scripts/machine-setup.sh
```

On success, `./scripts/mcp-smoke.sh` exits 0 and `./sync.sh status` shows doctrine files linked for Claude, Codex, Cursor, and OpenCode.

Re-run `./scripts/mcp-smoke.sh` anytime after rotating secrets.

## Interactive auth (human required once per machine)

Setup does **not** replace subscription login. After CLIs install, complete device auth if commands fail with not-logged-in errors:

| CLI | Command | Verify |
| --- | --- | --- |
| Claude | `claude auth login` | follow code-paste flow |
| Codex | `codex login --device-auth` | `codex login status` |
| Cursor | `cursor-agent login` | `cursor-agent status` |
| OpenCode | `opencode auth login` (only to use a model provider) | `opencode auth list` |

Use device-code / URL flows on headless hosts (not localhost OAuth callbacks). The doctrine MCP wiring for OpenCode needs no login; only a model provider does.

## MCP reference (prescribed)

| Server | URL / command | Auth |
| --- | --- | --- |
| **semble** | stdio: `semble` | none (indexes local checkouts you search) |
| **honcho** | `https://mcp.honcho.dev` | `Authorization: Bearer $HONCHO_API_KEY`, `X-Honcho-User-Name: $HONCHO_PEER_NAME`, `X-Honcho-Workspace-ID: $HONCHO_WORKSPACE` |
| **porch** | `https://porch.sh/mcp` | `Authorization: Bearer $PORCH_MCP_TOKEN`; also `~/.config/porch/mcp.env` |

Host overlays: `hosts/claude.md`, `hosts/codex.md`, `hosts/cursor.md`, `hosts/opencode.md`. Shared contract: root `CLAUDE.md`, `HANDOFFS.md`.

OpenCode: MCP lives under `mcp.servers` in `~/.config/opencode/opencode.json(c)`. `scripts/wire-opencode-mcp.ts` preserves comments and unrelated settings, uses `{env:...}` references, never writes secret values, and omits honcho/porch when their environment variables are absent. It fails without changing the file on invalid JSONC. `scripts/wire-opencode-provider.ts` merges `providers.cliproxyapi` when `CLIPROXY_BASE_URL` and `CLIPROXY_API_KEY` are both set, removes it when either is absent, and writes the key only as `{env:CLIPROXY_API_KEY}`. OpenCode runs as a V2 service on `0.0.0.0:4096` with `OPENCODE_SERVER_PASSWORD` (required; no default); the server process needs `HONCHO_API_KEY`, `HONCHO_WORKSPACE`, `HONCHO_PEER_NAME`, `PORCH_MCP_TOKEN`, and `CLIPROXY_API_KEY` to resolve its `{env:...}` references.

Cursor: after wiring, `cursor-agent mcp enable porch` (and honcho/semble) if tools do not appear.

Codex: Honcho may need extra headers beyond `bearer_token_env_var`; if `codex mcp list` shows honcho errors, align with Cursor header set via Codex MCP docs or paste headers from `~/.cursor/mcp.json` into Codex config.

## Doctrine verification

```bash
./sync.sh status
test -f ~/.claude/CLAUDE.md
test -f ~/.codex/AGENTS.md
test -f ~/.cursor/rules/doctrine.mdc
test -f ~/.config/opencode/AGENTS.md
test -f ~/.config/opencode/agents/simplifier.md
test -f ~/.claude/TASTE.md && test -f ~/.cursor/TASTE.md
```

Generated host files must not be edited by hand; change this repo, then `doctrine-sync sync-all` (or `./sync.sh sync-all`).

## LOCAL.md

Create machine-specific notes at `~/.claude/LOCAL.md` (SSH hosts, infra quirks). `./sync.sh reconcile-local` keeps `~/.codex/LOCAL.md`, `~/.cursor/LOCAL.md`, and `~/.config/opencode/LOCAL.md` as symlinks to the same file. `LOCAL.md` is never committed.

## Failure handling

- Missing secret → export it, run `python3 scripts/wire-mcp.py`, then `./scripts/mcp-smoke.sh`.
- `semble` missing → `uv tool install --force "semble[mcp]"` and ensure `$HOME/.local/bin` is on `PATH`.
- Doctrine drift → `./sync.sh pull-all && ./sync.sh sync-all`.
- Honcho 403 → check `HONCHO_PEER_NAME` and workspace id match [app.honcho.dev](https://app.honcho.dev).
