#!/usr/bin/env bash
set -euo pipefail

# provision a portable agent workstation on a remote vm that already runs docker.
# the deploy bundle is workstation/ in this repo. this script stages compose.yaml,
# a generated .env, and secret files, copies them to the target, starts the
# container, and waits for health. it never echoes secret values.

usage() {
  cat >&2 <<'USAGE'
usage: setup-new-machine.sh <ssh-target> [--name <name>] [--dir <path>] [--image <ref>] [--dry-run]

  <ssh-target>   ssh destination of the target vm, for example root@203.0.113.10
  --name <name>  tailscale hostname for the new workstation (required)
  --dir <path>   remote deploy directory (default: the target $HOME/workspaces/<name>)
  --image <ref>  workstation image (default: $WORKSTATION_IMAGE or the ghcr main tag)
  --dry-run      print the plan and the secret file names, then exit 0 without touching the vm
USAGE
}

die() {
  echo "setup-new-machine: $*" >&2
  exit 1
}

# write one KEY="escaped" dotenv line. reject a newline or carriage return in the value.
# docker compose reads a double-quoted value literally, so escape `\`, `"`, and `$`.
env_line() {
  local key="$1" value="$2"
  case "$value" in
    *$'\n'*|*$'\r'*) die "invalid $key: value contains a newline or carriage return" ;;
  esac
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\$/\\\$}"
  printf '%s="%s"\n' "$key" "$value"
}

ssh_target=""
name=""
remote_dir=""
image="${WORKSTATION_IMAGE:-ghcr.io/example/agent-workstation:main}"
dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) name="${2:-}"; shift 2 ;;
    --dir) remote_dir="${2:-}"; shift 2 ;;
    --image) image="${2:-}"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *)
      [[ -z "$ssh_target" ]] || die "unexpected extra argument: $1"
      ssh_target="$1"
      shift
      ;;
  esac
done

[[ -n "$ssh_target" ]] || { usage; die "missing ssh target"; }
[[ -n "$name" ]] || { usage; die "missing --name (the workstation tailscale hostname)"; }

# validate every operator input before the first ssh command or dry-run output.
[[ "$name" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || die "invalid --name: $name (one lowercase hostname label: a-z, 0-9, -)"
[[ "${#name}" -le 63 ]] || die "invalid --name: $name (longer than 63 characters)"
[[ "$image" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]*$ ]] || die "invalid --image: $image"
ghcr_user="${GHCR_USER:-operator}"
[[ "$ghcr_user" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || die "invalid GHCR_USER: $ghcr_user"
qimage="$(printf '%q' "$image")"
quser="$(printf '%q' "$ghcr_user")"

repo="${CLAUDE_MD_DIR:-$HOME/.claude/.claude-md-repo}"
[[ -f "$repo/workstation/compose.yaml" ]] || die "workstation bundle not found at $repo/workstation/compose.yaml (set CLAUDE_MD_DIR to the repo root)"

secret_names="tailscale_auth_key honcho_api_key porch_mcp_token claude_auth codex_auth opencode_auth cliproxy_api_key"
default_remote_dir="\$HOME/workspaces/$name"

if [[ "$dry_run" -eq 1 ]]; then
  if [[ -n "$remote_dir" ]]; then
    qdisplay_dir="$(printf '%q' "$remote_dir")"
  else
    qdisplay_dir="$default_remote_dir"
  fi
  echo "setup-new-machine dry run"
  echo "  ssh target:  $ssh_target"
  echo "  name:        $name"
  echo "  remote dir:  $qdisplay_dir"
  echo "  image:       $image"
  echo "  ghcr user:   $ghcr_user (login only when the image is not already pullable)"
  echo "  secrets:     $secret_names"
  echo "  tailnet:     $name"
  echo "  connect:     ssh coder@$name"
  echo "  endpoint:    http://$name:4096"
  echo "remote actions:"
  echo "  ssh $ssh_target 'printf %s \"\$HOME\"'"
  echo "  ssh $ssh_target 'docker version >/dev/null 2>&1'"
  echo "  ssh $ssh_target 'docker compose version >/dev/null 2>&1'"
  echo "  ssh $ssh_target 'docker manifest inspect $image'"
  echo "  unless the image is pullable: printf '%s' \"\$GHCR_TOKEN\" | ssh $ssh_target 'docker login ghcr.io -u $ghcr_user --password-stdin'"
  echo "  tar -C <staging> -cf - . | ssh $ssh_target 'mkdir -p $qdisplay_dir && tar -C $qdisplay_dir -xf -'"
  echo "  ssh $ssh_target 'cd $qdisplay_dir && docker compose pull -q && docker compose up -d'"
  echo "  poll 180s: ssh $ssh_target 'cd $qdisplay_dir && docker inspect -f \"{{.State.Health.Status}}\" \$(docker compose ps -q workstation)'"
  echo "no vm action and no secret staged."
  exit 0
fi

: "${OPENCODE_SERVER_PASSWORD:?set OPENCODE_SERVER_PASSWORD}"
: "${HONCHO_WORKSPACE:?set HONCHO_WORKSPACE}"
: "${HONCHO_PEER_NAME:?set HONCHO_PEER_NAME}"
[[ "$image" != ghcr.io/example/* ]] || die "set WORKSTATION_IMAGE or --image to your published image"

command -v ssh >/dev/null 2>&1 || die "ssh not found on this machine"
command -v tar >/dev/null 2>&1 || die "tar not found on this machine"

# preflight the ssh target and resolve its home directory.
remote_home="$(ssh "$ssh_target" 'printf %s "$HOME"')" || die "ssh preflight failed for $ssh_target"
[[ -n "$remote_home" ]] || die "could not resolve \$HOME on $ssh_target"
if [[ -z "$remote_dir" ]]; then
  remote_dir="$remote_home/workspaces/$name"
elif [[ "$remote_dir" == '~/'* ]]; then
  remote_dir="$remote_home/${remote_dir#\~/}"
fi

ssh "$ssh_target" "docker version >/dev/null 2>&1" || die "docker is not available on $ssh_target"
ssh "$ssh_target" "docker compose version >/dev/null 2>&1" || die "the docker compose plugin is not available on $ssh_target"

if ! ssh "$ssh_target" "docker manifest inspect $qimage >/dev/null 2>&1"; then
  ghcr_token="${GHCR_TOKEN:-}"
  if [[ -z "$ghcr_token" ]] && command -v gh >/dev/null 2>&1; then
    ghcr_token="$(gh auth token 2>/dev/null || true)"
  fi
  [[ -n "$ghcr_token" ]] || die "cannot pull $image: set GHCR_TOKEN or log in with gh"
  printf '%s' "$ghcr_token" | ssh "$ssh_target" "docker login ghcr.io -u $quser --password-stdin >/dev/null" \
    || die "docker login ghcr.io failed on $ssh_target"
fi

# stage the bundle locally. mode 0600 for every staged secret, removed on exit.
staging="$(mktemp -d "${TMPDIR:-/tmp}/setup-new-machine.XXXXXX")"
trap 'rm -rf "$staging"' EXIT
umask 077

install -m 0600 "$repo/workstation/compose.yaml" "$staging/compose.yaml"
mkdir -p "$staging/secrets"
chmod 0700 "$staging/secrets"

{
  env_line WORKSTATION_HOSTNAME "$name"
  env_line WORKSTATION_IMAGE "$image"
  if [[ -n "${CLIPROXY_BASE_URL:-}" ]]; then env_line CLIPROXY_BASE_URL "$CLIPROXY_BASE_URL"; fi
  if [[ -n "${OPENCODE_SERVER_PORT:-}" ]]; then env_line OPENCODE_SERVER_PORT "$OPENCODE_SERVER_PORT"; fi
  if [[ -n "${OPENCODE_SERVER_PASSWORD:-}" ]]; then env_line OPENCODE_SERVER_PASSWORD "$OPENCODE_SERVER_PASSWORD"; fi
  if [[ -n "${HONCHO_WORKSPACE:-}" ]]; then env_line HONCHO_WORKSPACE "$HONCHO_WORKSPACE"; fi
  if [[ -n "${HONCHO_PEER_NAME:-}" ]]; then env_line HONCHO_PEER_NAME "$HONCHO_PEER_NAME"; fi
} >"$staging/.env"
chmod 0600 "$staging/.env"

# required secrets: the container entrypoint calls require_secret on these.
[[ -n "${TAILSCALE_AUTH_KEY:-}" ]] || die "TAILSCALE_AUTH_KEY is required but not set on this machine"
printf '%s' "$TAILSCALE_AUTH_KEY" >"$staging/secrets/tailscale_auth_key"

honcho_config="$HOME/.honcho/config.json"
honcho_key=""
if [[ -f "$honcho_config" ]]; then
  honcho_key="$(grep -o '"apiKey"[[:space:]]*:[[:space:]]*"[^"]*"' "$honcho_config" | head -n1 | sed -E 's/^[^:]*:[[:space:]]*"//; s/"$//')"
fi
[[ -n "$honcho_key" ]] || die "honcho api key not found in $honcho_config"
printf '%s' "$honcho_key" >"$staging/secrets/honcho_api_key"

porch_env="$HOME/.config/porch/mcp.env"
porch_token=""
if [[ -f "$porch_env" ]]; then
  porch_token="$(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?PORCH_MCP_TOKEN=//p' "$porch_env" | head -n1)"
  porch_token="${porch_token%\"}"; porch_token="${porch_token#\"}"
  porch_token="${porch_token%\'}"; porch_token="${porch_token#\'}"
fi
[[ -n "$porch_token" ]] || die "porch mcp token not found in $porch_env"
printf '%s' "$porch_token" >"$staging/secrets/porch_mcp_token"

# optional cli auth: the entrypoint imports each only when the file is nonempty.
stage_optional_file() {
  local target="$staging/secrets/$1" source="$2"
  if [[ -s "$source" ]]; then
    install -m 0600 "$source" "$target"
  else
    install -m 0600 /dev/null "$target"
    echo "setup-new-machine: warning: $source not found; staging $1 empty" >&2
  fi
}
stage_optional_file claude_auth "$HOME/.claude/.credentials.json"
stage_optional_file codex_auth "$HOME/.codex/auth.json"
stage_optional_file opencode_auth "$HOME/.local/share/opencode/auth.json"

if [[ -n "${CLIPROXY_API_KEY:-}" ]]; then
  printf '%s' "$CLIPROXY_API_KEY" >"$staging/secrets/cliproxy_api_key"
else
  install -m 0600 /dev/null "$staging/secrets/cliproxy_api_key"
fi

chmod 0600 "$staging"/secrets/*
chmod 0700 "$staging/secrets"

qdir="$(printf '%q' "$remote_dir")"
tar -C "$staging" -cf - . | ssh "$ssh_target" "mkdir -p $qdir && tar -C $qdir -xf -" \
  || die "failed to copy the bundle to $ssh_target:$remote_dir"

ssh "$ssh_target" "cd $qdir && docker compose pull -q && docker compose up -d" \
  || die "docker compose up failed on $ssh_target"

deadline=$((SECONDS + 180))
health=""
while (( SECONDS < deadline )); do
  health="$(ssh "$ssh_target" "cd $qdir && docker inspect -f '{{.State.Health.Status}}' \$(docker compose ps -q workstation)" 2>/dev/null || true)"
  case "$health" in
    healthy) break ;;
    unhealthy) die "container reported unhealthy on $ssh_target" ;;
  esac
  sleep 5
done
[[ "$health" == "healthy" ]] || die "container did not become healthy within 180s on $ssh_target (last status: ${health:-unknown})"

echo
echo "workstation ready: $name"
echo "  tailnet:  $name"
echo "  connect:  ssh coder@$name"
echo "  endpoint: http://$name:4096"
echo "  dir:      $remote_dir"
