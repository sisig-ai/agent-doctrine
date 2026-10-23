#!/usr/bin/env bash
set -euo pipefail

repo="${CLAUDE_MD_DIR:-$HOME/.claude/.claude-md-repo}"

resolve_bun() {
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi
  if [[ -x "$HOME/.local/bin/bun" ]]; then
    printf '%s\n' "$HOME/.local/bin/bun"
    return 0
  fi
  if [[ -x "$HOME/.bun/bin/bun" ]]; then
    printf '%s\n' "$HOME/.bun/bin/bun"
    return 0
  fi
  if [[ -f "$HOME/.asdf/asdf.sh" ]]; then
    # shellcheck disable=SC1090
    . "$HOME/.asdf/asdf.sh"
    if command -v bun >/dev/null 2>&1; then
      command -v bun
      return 0
    fi
  fi
  echo "bun not found. Install bun at ~/.local/bin/bun or make it available through asdf." >&2
  return 1
}

bun_bin="$(resolve_bun)"
exec "$bun_bin" "$repo/src/cli.ts" "$@"
