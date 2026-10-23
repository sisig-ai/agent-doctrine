#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export CLAUDE_MD_DIR="$REPO_ROOT"
export PATH="$HOME/.local/bin:$HOME/.opencode/bin:$HOME/.bun/bin:$PATH"

log() { echo "[machine-setup] $*"; }

ensure_path() {
  mkdir -p "$HOME/.local/bin" "$HOME/.opencode/bin"
  for dir in "$HOME/.opencode/bin" "$HOME/.local/bin"; do
    case ":$PATH:" in
      *":$dir:"*) ;;
      *) export PATH="$dir:$PATH" ;;
    esac
  done
}

ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    return 0
  fi
  log "installing bun"
  curl -fsSL https://bun.sh/install | bash -s -- bun-v1.4.2
  export PATH="$HOME/.bun/bin:$PATH"
}

ensure_uv() {
  if command -v uv >/dev/null 2>&1; then
    return 0
  fi
  log "installing uv"
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$HOME/.local/bin" sh
}

ensure_agent_cli() {
  local name="$1" install_cmd="$2"
  if command -v "$name" >/dev/null 2>&1; then
    log "$name already installed ($("$name" --version 2>&1 | head -1 || true))"
    return 0
  fi
  log "installing $name"
  bash -lc "$install_cmd"
}

opencode_major() {
  opencode --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || true
}

ensure_opencode_v2() {
  if [[ "$(opencode_major)" == 2 ]]; then
    log "opencode already installed ($(opencode --version 2>&1 | head -1 || true))"
    return 0
  fi
  log "installing opencode V2"
  curl -fsSL https://opencode.ai/v2/install | bash
  export PATH="$HOME/.opencode/bin:$PATH"
  if [[ "$(opencode_major)" != 2 ]]; then
    log "opencode V2 is unavailable after install; refusing to continue"
    exit 1
  fi
  log "opencode $(opencode --version 2>&1 | head -1 || true)"
}

: "${OPENCODE_SERVER_PASSWORD:?set OPENCODE_SERVER_PASSWORD}"
: "${HONCHO_API_KEY:?set HONCHO_API_KEY}"
: "${HONCHO_WORKSPACE:?set HONCHO_WORKSPACE}"
: "${HONCHO_PEER_NAME:?set HONCHO_PEER_NAME}"
: "${PORCH_MCP_TOKEN:?set PORCH_MCP_TOKEN}"

ensure_path
ensure_bun
ensure_uv

ensure_agent_cli claude 'curl -fsSL https://claude.ai/install.sh | bash'
ensure_agent_cli codex 'curl -fsSL https://chatgpt.com/codex/install.sh | sh'
ensure_agent_cli cursor-agent 'curl -fsSL https://cursor.com/install | bash'
ensure_opencode_v2

log "installing semble (uv tool)"
UV_TOOL_BIN_DIR="$HOME/.local/bin" uv tool install --force "semble[mcp]"

cd "$REPO_ROOT"
log "bun install (doctrine sync deps)"
bun install
log "doctrine sync wrappers + LOCAL.md reconcile"
./sync.sh install
log "pull and sync doctrine to claude, codex, cursor homes"
./sync.sh pull-all

log "wire MCP servers (honcho, semble, porch)"
python3 "$REPO_ROOT/scripts/wire-mcp.py"
log "wire OpenCode MCP servers (honcho, semble, porch)"
bun "$REPO_ROOT/scripts/wire-opencode-mcp.ts"
export CLIPROXY_BASE_URL="${CLIPROXY_BASE_URL:-}"
log "wire OpenCode cliproxyapi provider"
bun "$REPO_ROOT/scripts/wire-opencode-provider.ts"

OPENCODE_SERVER_PORT="${OPENCODE_SERVER_PORT:-4096}"
OPENCODE_SERVER_PASSWORD="${OPENCODE_SERVER_PASSWORD:?set OPENCODE_SERVER_PASSWORD}"
export OPENCODE_SERVER_PORT OPENCODE_SERVER_PASSWORD
log "configure OpenCode service on 0.0.0.0:${OPENCODE_SERVER_PORT}"
opencode service stop >/dev/null 2>&1
opencode service set hostname 0.0.0.0
opencode service set port "$OPENCODE_SERVER_PORT"
opencode service set password "$OPENCODE_SERVER_PASSWORD"
opencode service start
opencode_ready=0
for _ in $(seq 1 60); do
  if curl -fsS -u "opencode:$OPENCODE_SERVER_PASSWORD" "http://127.0.0.1:$OPENCODE_SERVER_PORT/api/info" >/dev/null 2>&1; then
    opencode_ready=1
    break
  fi
  sleep 1
done
if [[ "$opencode_ready" -ne 1 ]]; then
  log "OpenCode service did not answer on 127.0.0.1:${OPENCODE_SERVER_PORT} within 60s"
  opencode service status >&2 2>/dev/null || true
  exit 1
fi
log "OpenCode service ready at http://0.0.0.0:${OPENCODE_SERVER_PORT}"

if command -v cursor-agent >/dev/null 2>&1; then
  cursor-agent mcp enable porch 2>/dev/null || true
  cursor-agent mcp enable honcho 2>/dev/null || true
  cursor-agent mcp enable semble 2>/dev/null || true
fi

log "smoke test MCP configuration"
"$REPO_ROOT/scripts/mcp-smoke.sh"

log "doctrine status"
./sync.sh status

log "done. if claude/codex/cursor-agent are not logged in, complete device auth (see SETUP.md). opencode needs no auth for the wired MCP servers."
