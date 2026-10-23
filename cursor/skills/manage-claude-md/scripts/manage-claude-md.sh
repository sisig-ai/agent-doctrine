#!/usr/bin/env bash
set -euo pipefail
if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo 'usage: manage-claude-md.sh <sync-command> [ssh-target]' >&2
  exit 2
fi
action="$1"
[[ "$action" =~ ^[a-z][a-z-]*$ ]] || { echo 'invalid sync command' >&2; exit 2; }
if [[ $# -eq 1 ]]; then
  repo="${CLAUDE_MD_DIR:-$HOME/.claude/.claude-md-repo}"
  exec "$repo/sync.sh" "$action"
fi
target="$2"
[[ "$target" =~ ^[A-Za-z0-9_][A-Za-z0-9_.@-]*$ ]] || { echo 'invalid ssh target' >&2; exit 2; }
exec ssh -- "$target" "bash -lc '"\$HOME/.claude/.claude-md-repo/sync.sh" $action'"
