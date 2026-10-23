#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

fail=0

check() {
  if "$@"; then
    echo "ok: $*"
  else
    echo "FAIL: $*" >&2
    fail=1
  fi
}

curl_bin="${MCP_SMOKE_CURL_BIN:-curl}"

honcho_request() {
  "$curl_bin" --config - >/dev/null <<EOF
silent
show-error
fail
request = "POST"
header = "Authorization: Bearer ${HONCHO_API_KEY}"
header = "Content-Type: application/json"
url = "https://api.honcho.dev/v3/workspaces/${HONCHO_WORKSPACE}/conclusions/list"
data = "{\"page\":1,\"size\":1}"
EOF
}

porch_request() {
  "$curl_bin" --config - <<EOF
silent
show-error
fail
request = "POST"
header = "Authorization: Bearer ${PORCH_MCP_TOKEN}"
header = "Content-Type: application/json"
url = "https://porch.sh/mcp"
data = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}"
EOF
}

if command -v semble >/dev/null 2>&1; then
  check semble --help >/dev/null
else
  echo "FAIL: semble not on PATH" >&2
  fail=1
fi

if [[ -n "${HONCHO_API_KEY:-}" && -n "${HONCHO_WORKSPACE:-}" ]]; then
  if honcho_request; then
    echo "ok: honcho conclusions/list smoke"
  else
    echo "FAIL: honcho conclusions/list smoke" >&2
    fail=1
  fi
else
  echo "FAIL: HONCHO_API_KEY or HONCHO_WORKSPACE unset" >&2
  fail=1
fi

if [[ -n "${PORCH_MCP_TOKEN:-}" ]]; then
  body="$(porch_request || true)"
  if [[ -z "$body" ]] || ! printf '%s' "$body" | python3 -c 'import json,sys; d=json.load(sys.stdin); t=",".join(x["name"] for x in d.get("result",{}).get("tools",[])); assert "vault_search" in t and "vault_save" in t' 2>/dev/null; then
    echo "FAIL: porch tools/list smoke" >&2
    fail=1
  else
    echo "ok: porch tools/list (vault_search, vault_save)"
  fi
  if [[ -f "$HOME/.config/porch/mcp.env" ]]; then
    mode="$(stat -c '%a' "$HOME/.config/porch/mcp.env")"
    if [[ "$mode" == "600" ]]; then
      echo "ok: porch mcp.env mode 600"
    else
      echo "FAIL: porch mcp.env mode $mode (want 600)" >&2
      fail=1
    fi
  fi
else
  echo "FAIL: PORCH_MCP_TOKEN unset" >&2
  fail=1
fi

for f in "$HOME/.cursor/mcp.json" "$HOME/.claude/settings.json"; do
  if [[ -f "$f" ]] && python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); s=d.get("mcpServers",{}); assert "semble" in s' "$f" 2>/dev/null; then
    echo "ok: $f has semble"
  else
    echo "FAIL: $f missing semble entry" >&2
    fail=1
  fi
done

opencode_target="${OPENCODE_MD_TARGET:-$HOME/.config/opencode}"
opencode_cfg=""
for candidate in "$opencode_target/opencode.jsonc" "$opencode_target/opencode.json"; do
  if [[ -f "$candidate" ]]; then
    opencode_cfg="$candidate"
    break
  fi
done
if [[ -n "$opencode_cfg" ]] && (cd "$REPO_ROOT" && bun -e '
const { parse } = require("jsonc-parser");
const fs = require("fs");
const errors = [];
const data = parse(fs.readFileSync(process.argv[1], "utf8"), errors, { allowTrailingComma: true, disallowComments: false });
if (errors.length) process.exit(2);
const servers = (data && data.mcp && data.mcp.servers) || {};
process.exit("semble" in servers ? 0 : 1);
' "$opencode_cfg") 2>/dev/null; then
  echo "ok: $opencode_cfg has mcp.servers.semble"
else
  echo "FAIL: $opencode_cfg missing or invalid mcp.servers.semble" >&2
  fail=1
fi

run_bounded() {
  local secs="$1"; shift
  local out
  out="$(mktemp)"
  "$@" >"$out" 2>&1 &
  local pid=$!
  local waited=0
  while kill -0 "$pid" 2>/dev/null && [[ "$waited" -lt "$secs" ]]; do
    sleep 1
    waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    cat "$out"
    rm -f "$out"
    return 124
  fi
  local status=0
  wait "$pid" || status=$?
  cat "$out"
  rm -f "$out"
  return "$status"
}

if command -v opencode >/dev/null 2>&1; then
  listing="$(run_bounded 45 opencode mcp list 2>/dev/null || true)"
  if printf '%s' "$listing" | grep -q "semble"; then
    echo "ok: opencode mcp list shows semble"
  else
    echo "WARN: opencode mcp list did not show semble within 45s (service may be unavailable); config check above is authoritative" >&2
  fi
else
  echo "WARN: opencode not on PATH; skipped mcp list smoke" >&2
fi

exit "$fail"
