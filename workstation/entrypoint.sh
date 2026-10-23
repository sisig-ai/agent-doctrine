#!/usr/bin/env bash
set -euo pipefail

ready=/run/workstation/ready
rm -f "$ready"
mkdir -p /run/workstation /var/lib/docker /var/lib/tailscale /var/run/tailscale /home/coder
chown coder:coder /home/coder

require_secret() {
  local name="$1"
  local path="/run/secrets/$name"
  if [[ ! -s "$path" ]]; then
    echo "required secret is missing or empty: $name" >&2
    exit 1
  fi
}

require_secret honcho_api_key
require_secret porch_mcp_token
: "${HONCHO_WORKSPACE:?HONCHO_WORKSPACE is required}"
: "${HONCHO_PEER_NAME:?HONCHO_PEER_NAME is required}"
: "${WORKSTATION_HOSTNAME:?WORKSTATION_HOSTNAME is required}"
export CLIPROXY_BASE_URL="${CLIPROXY_BASE_URL:-}"

{
cat <<'EOF'
export HONCHO_API_KEY="$(cat /run/secrets/honcho_api_key)"
export PORCH_MCP_TOKEN="$(cat /run/secrets/porch_mcp_token)"
EOF
printf 'export HONCHO_WORKSPACE=%q\n' "$HONCHO_WORKSPACE"
printf 'export HONCHO_PEER_NAME=%q\n' "$HONCHO_PEER_NAME"
printf 'export CLIPROXY_BASE_URL=%q\n' "$CLIPROXY_BASE_URL"
cat <<'EOF'
export CLIPROXY_API_KEY="$(cat /run/secrets/cliproxy_api_key 2>/dev/null || true)"
export CLAUDE_MD_DIR=/opt/claude-md
export CLAUDE_MD_SNAPSHOT=1
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin"
EOF
} >/etc/profile.d/workstation-secrets.sh
chmod 0644 /etc/profile.d/workstation-secrets.sh

export HONCHO_API_KEY="$(cat /run/secrets/honcho_api_key)"
export PORCH_MCP_TOKEN="$(cat /run/secrets/porch_mcp_token)"
if [[ -s /run/secrets/cliproxy_api_key ]]; then
  export CLIPROXY_API_KEY="$(cat /run/secrets/cliproxy_api_key)"
fi
export HOME=/home/coder
export CLAUDE_MD_DIR=/opt/claude-md
export CLAUDE_MD_SNAPSHOT=1

as_coder() {
  runuser -u coder --preserve-environment -- "$@"
}

import_auth() {
  local secret="$1" target="$2"
  if [[ -s "/run/secrets/$secret" && ! -e "$target" ]]; then
    install -d -m 0700 -o coder -g coder "$(dirname "$target")"
    install -m 0600 -o coder -g coder "/run/secrets/$secret" "$target"
  fi
}
import_auth claude_auth /home/coder/.claude/.credentials.json
import_auth codex_auth /home/coder/.codex/auth.json
import_auth opencode_auth /home/coder/.local/share/opencode/auth.json

if [[ ! -e /home/coder/.claude/LOCAL.md ]]; then
  install -d -m 0700 -o coder -g coder /home/coder/.claude
  sed "s/__WORKSTATION_HOSTNAME__/${WORKSTATION_HOSTNAME//\//\\/}/g" \
    /opt/claude-md/workstation/portable-LOCAL.md >/home/coder/.claude/LOCAL.md
  chown coder:coder /home/coder/.claude/LOCAL.md
  chmod 0600 /home/coder/.claude/LOCAL.md
fi

dockerd --host=unix:///var/run/docker.sock >/var/log/dockerd.log 2>&1 &
dockerd_pid=$!
tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock \
  >/var/log/tailscaled.log 2>&1 &
tailscaled_pid=$!

cleanup() {
  rm -f "$ready"
  kill "${t3_pid:-}" "${opencode_pid:-}" "$tailscaled_pid" "$dockerd_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 90); do
  docker info >/dev/null 2>&1 && break
  kill -0 "$dockerd_pid" 2>/dev/null || { cat /var/log/dockerd.log >&2; exit 1; }
  sleep 1
done
docker info >/dev/null 2>&1 || { echo "dockerd did not become ready" >&2; exit 1; }

for _ in $(seq 1 30); do
  [[ -S /var/run/tailscale/tailscaled.sock ]] && break
  kill -0 "$tailscaled_pid" 2>/dev/null || { cat /var/log/tailscaled.log >&2; exit 1; }
  sleep 1
done
[[ -S /var/run/tailscale/tailscaled.sock ]] || { echo "tailscaled socket did not become ready" >&2; exit 1; }

if ! tailscale status --json 2>/dev/null | python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin).get("BackendState") == "Running" else 1)'; then
  require_secret tailscale_auth_key
  tailscale up --auth-key=file:/run/secrets/tailscale_auth_key --hostname="$WORKSTATION_HOSTNAME" --ssh
fi
for _ in $(seq 1 60); do
  tailscale status --json 2>/dev/null | python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin).get("BackendState") == "Running" else 1)' && break
  sleep 1
done
tailscale status --json | python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin).get("BackendState") == "Running" else 1)' \
  || { echo "tailscale did not become online" >&2; exit 1; }

as_coder /opt/claude-md/sync.sh apply-snapshot
as_coder python3 /opt/claude-md/scripts/wire-mcp.py
as_coder bun /opt/claude-md/scripts/wire-opencode-mcp.ts
as_coder bun /opt/claude-md/scripts/wire-opencode-provider.ts
as_coder /opt/claude-md/scripts/mcp-smoke.sh

OPENCODE_SERVER_PORT="${OPENCODE_SERVER_PORT:-4096}"
OPENCODE_SERVER_PASSWORD="${OPENCODE_SERVER_PASSWORD:?set OPENCODE_SERVER_PASSWORD}"
export OPENCODE_SERVER_PORT OPENCODE_SERVER_PASSWORD
as_coder bash -c 'set -a; . /etc/profile.d/workstation-secrets.sh; set +a
  opencode service set hostname 0.0.0.0
  opencode service set port "$OPENCODE_SERVER_PORT"
  opencode service set password "$OPENCODE_SERVER_PASSWORD"'
as_coder bash -c 'set -a; . /etc/profile.d/workstation-secrets.sh; set +a; exec opencode serve --service' \
  >/var/log/opencode.log 2>&1 &
opencode_pid=$!

for _ in $(seq 1 60); do
  python3 - "$OPENCODE_SERVER_PORT" <<'PY' && break
import socket,sys
try:
    with socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=1): pass
except OSError:
    raise SystemExit(1)
PY
  kill -0 "$opencode_pid" 2>/dev/null || { cat /var/log/opencode.log >&2; echo "opencode service exited before becoming ready" >&2; exit 1; }
  sleep 1
done
python3 - "$OPENCODE_SERVER_PORT" <<'PY'
import socket,sys
with socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=2): pass
PY
echo "$opencode_pid" >/run/workstation/opencode.pid

tailscale_ip="$(tailscale ip -4 | head -n1)"
[[ -n "$tailscale_ip" ]] || { echo "tailscale has no ipv4 address" >&2; exit 1; }
as_coder t3 serve --host "$tailscale_ip" --port 3773 >/var/log/t3.log 2>&1 &
t3_pid=$!
echo "$dockerd_pid" >/run/workstation/dockerd.pid
echo "$tailscaled_pid" >/run/workstation/tailscaled.pid
echo "$t3_pid" >/run/workstation/t3.pid

for _ in $(seq 1 60); do
  python3 - "$tailscale_ip" <<'PY' && break
import socket,sys
try:
    with socket.create_connection((sys.argv[1], 3773), timeout=1): pass
except OSError:
    raise SystemExit(1)
PY
  kill -0 "$t3_pid" 2>/dev/null || { cat /var/log/t3.log >&2; exit 1; }
  sleep 1
done
python3 - "$tailscale_ip" <<'PY'
import socket,sys
with socket.create_connection((sys.argv[1], 3773), timeout=2): pass
PY

touch "$ready"
chmod 0644 "$ready"

while true; do
  for pid in "$dockerd_pid" "$tailscaled_pid" "$t3_pid" "$opencode_pid"; do
    kill -0 "$pid" 2>/dev/null || { echo "critical workstation process exited: $pid" >&2; exit 1; }
  done
  sleep 5
done
