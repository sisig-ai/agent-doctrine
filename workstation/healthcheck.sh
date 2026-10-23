#!/usr/bin/env bash
set -euo pipefail

test -f /run/workstation/ready
for service in dockerd tailscaled t3 opencode; do
  pid="$(cat "/run/workstation/$service.pid")"
  kill -0 "$pid"
done
docker info >/dev/null 2>&1
tailscale status --json | python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin).get("BackendState") == "Running" else 1)'
curl -fsS -u "opencode:${OPENCODE_SERVER_PASSWORD:?set OPENCODE_SERVER_PASSWORD}" "http://127.0.0.1:${OPENCODE_SERVER_PORT:-4096}/api/info" >/dev/null

tailscale_ip="$(tailscale ip -4 | head -n1)"
python3 - "$tailscale_ip" <<'PY'
import socket,sys
with socket.create_connection((sys.argv[1], 3773), timeout=2): pass
PY

for binary in claude codex opencode t3 tmux tokensieve semble bun uv docker tailscale; do
  command -v "$binary" >/dev/null
done

test -f /home/coder/.claude/CLAUDE.md
test -f /home/coder/.codex/AGENTS.md
test -f /home/coder/.cursor/rules/doctrine.mdc
test -f /home/coder/.config/opencode/AGENTS.md
for path in /home/coder/.codex/LOCAL.md /home/coder/.cursor/LOCAL.md /home/coder/.config/opencode/LOCAL.md; do
  test -L "$path"
  test "$(readlink -f "$path")" = /home/coder/.claude/LOCAL.md
done
test -f /home/coder/.claude/LOCAL.md

python3 - <<'PY'
import json
from pathlib import Path
for path in [Path('/home/coder/.claude/settings.json'), Path('/home/coder/.cursor/mcp.json')]:
    servers=json.loads(path.read_text()).get('mcpServers', {})
    assert {'semble','honcho','porch'} <= servers.keys()
PY
for server in semble honcho porch; do
  grep -q "^\[mcp_servers\.$server\]$" /home/coder/.codex/config.toml
done
bun -e '
const { parse } = require("/opt/claude-md/node_modules/jsonc-parser");
const fs = require("fs");
const paths = ["/home/coder/.config/opencode/opencode.jsonc", "/home/coder/.config/opencode/opencode.json"];
const path = paths.find((p) => fs.existsSync(p));
if (!path) process.exit(1);
const servers = parse(fs.readFileSync(path, "utf8"))?.mcp?.servers ?? {};
for (const name of ["semble", "honcho", "porch"]) if (!(name in servers)) process.exit(1);
'
