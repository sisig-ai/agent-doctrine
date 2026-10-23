#!/usr/bin/env bash
# cleanup-worktrees.sh — remove git worktrees older than N days across all known locations.
#
# default: dry-run (list only). pass --apply to delete.
# branches are never deleted; only the worktree directories are removed.
set -euo pipefail

DAYS=3
APPLY=0
declare -a ROOTS=("$HOME")

usage() {
  cat >&2 <<'USAGE'
usage: cleanup-worktrees.sh [--days N] [--apply] [--root DIR]...

  --days N    age threshold in days (default 3). a worktree is old when its newest
              file mtime (excluding .git) is older than the threshold.
  --apply     remove the old worktrees. without this the script only lists them.
  --root DIR  extra directory to search for repos (repeatable). default: $HOME.
  -h, --help  show this help.

branches are never deleted. the primary checkout is never touched. sudo is used only
when a plain delete is refused by file permissions.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --days) DAYS="${2:?--days needs a number}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --root) ROOTS+=("${2:?--root needs a directory}"); shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done
[[ "$DAYS" =~ ^[0-9]+$ ]] || { echo "error: --days must be an integer, got '$DAYS'" >&2; exit 2; }

now=$(date +%s)
cutoff=$(( now - DAYS * 86400 ))

fmt_age() { printf '%dd' $(( (now - "$1") / 86400 )); }
newest_mtime() {
  local t
  t=$(find "$1" -type f -not -path '*/.git/*' -printf '%T@\n' 2>/dev/null | sort -nr | head -1 | cut -d. -f1 || true)
  [[ -n "$t" ]] || t=$(stat -c %Y "$1" 2>/dev/null || echo "$now")
  printf '%s' "$t"
}
size_of() { du -sh "$1" 2>/dev/null | cut -f1; }
df_avail() { df -Pk "$1" 2>/dev/null | awk 'NR==2{print $4}'; }

# --- discover repos that own worktrees (a repo has a .git/worktrees admin dir) ---
declare -a REPOS=()
while IFS= read -r d; do
  [[ -n "$d" ]] && REPOS+=("${d%/.git/worktrees}")
done < <(find "${ROOTS[@]}" -maxdepth 6 -type d -path '*/.git/worktrees' 2>/dev/null | sort -u)

# --- registered worktrees: "path<TAB>repo"; collect their parent dirs ---
declare -a REG=()
declare -a PARENTS=()
for repo in "${REPOS[@]}"; do
  [[ -d "$repo" ]] || continue
  p=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      worktree\ *) p="${line#worktree }" ;;
      "")
        if [[ -n "$p" ]]; then
          if [[ "$p" != "$repo" ]]; then
            REG+=("$p"$'\t'"$repo")
          fi
          PARENTS+=("$(dirname "$p")")
        fi
        p=""
        ;;
    esac
  done < <(git -C "$repo" worktree list --porcelain 2>/dev/null; printf '\n')
done

# --- orphan scan roots: parents under $HOME, never $HOME itself (avoids broad dirs) ---
declare -a SCAN=()
if [[ ${#PARENTS[@]} -gt 0 ]]; then
  while IFS= read -r d; do
    [[ -n "$d" ]] || continue
    if [[ "$d" == "$HOME"/* ]]; then
      SCAN+=("$d")
    fi
  done < <(printf '%s\n' "${PARENTS[@]}" | sort -u)
fi

in_reg() {
  local want="$1" e
  if [[ ${#REG[@]} -eq 0 ]]; then
    return 1
  fi
  for e in "${REG[@]}"; do
    [[ "${e%%$'\t'*}" == "$want" ]] && return 0
  done
  return 1
}

# --- build target lists (age<TAB>... ) ---
declare -a REG_OLD=()
declare -a ORPHAN_OLD=()
for e in "${REG[@]}"; do
  p="${e%%$'\t'*}"; repo="${e##*$'\t'}"
  [[ -d "$p" ]] || continue
  m=$(newest_mtime "$p")
  if [[ "$m" -lt "$cutoff" ]]; then
    d=$(git -C "$p" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    REG_OLD+=("$p"$'\t'"$repo"$'\t'"$(fmt_age "$m")"$'\t'"$(size_of "$p")"$'\t'"$d")
  fi
done
for parent in "${SCAN[@]}"; do
  [[ -d "$parent" ]] || continue
  for p in "$parent"/*/; do
    p="${p%/}"
    [[ -d "$p" ]] || continue
    in_reg "$p" && continue
    [[ -e "$p/.git" ]] && continue
    m=$(newest_mtime "$p")
    if [[ "$m" -lt "$cutoff" ]]; then
      ORPHAN_OLD+=("$p"$'\t'"$(fmt_age "$m")"$'\t'"$(size_of "$p")")
    fi
  done
done

total=$(( ${#REG_OLD[@]} + ${#ORPHAN_OLD[@]} ))
echo "cleanup-worktrees: threshold ${DAYS}d, roots: ${ROOTS[*]}"
if [[ "$total" -eq 0 ]]; then
  echo "nothing older than ${DAYS}d. nothing to do."
  exit 0
fi

echo
echo "registered worktrees older than ${DAYS}d (${#REG_OLD[@]}):"
for e in "${REG_OLD[@]}"; do
  IFS=$'\t' read -r p repo age size d <<<"$e"
  flag=""
  [[ "${d:-0}" -gt 0 ]] && flag=" DIRTY(${d})"
  printf '  %-6s %-7s %s%s  [%s]\n' "$age" "$size" "$p" "$flag" "$repo"
done
echo
echo "orphan leftovers older than ${DAYS}d (${#ORPHAN_OLD[@]}):"
for e in "${ORPHAN_OLD[@]}"; do
  IFS=$'\t' read -r p age size <<<"$e"
  printf '  %-6s %-7s %s\n' "$age" "$size" "$p"
done

if [[ "$APPLY" -ne 1 ]]; then
  echo
  echo "dry-run: ${total} target(s). re-run with --apply to remove them."
  exit 0
fi

echo
echo "removing ${total} target(s)..."
avail_before=$(df_avail "$HOME")
removed=0
for e in "${REG_OLD[@]}"; do
  IFS=$'\t' read -r p repo age size d <<<"$e"
  if git -C "$repo" worktree remove --force "$p" 2>/dev/null; then
    echo "  removed  $p"
    removed=$((removed+1))
  elif sudo rm -rf "$p" 2>/dev/null; then
    git -C "$repo" worktree prune 2>/dev/null || true
    echo "  removed  $p (sudo + prune)"
    removed=$((removed+1))
  else
    echo "  FAILED   $p" >&2
  fi
done
for e in "${ORPHAN_OLD[@]}"; do
  IFS=$'\t' read -r p age size <<<"$e"
  if rm -rf "$p" 2>/dev/null; then
    echo "  removed  $p"
    removed=$((removed+1))
  elif sudo rm -rf "$p" 2>/dev/null; then
    echo "  removed  $p (sudo)"
    removed=$((removed+1))
  else
    echo "  FAILED   $p" >&2
  fi
done
for repo in "${REPOS[@]}"; do
  git -C "$repo" worktree prune 2>/dev/null || true
done

avail_after=$(df_avail "$HOME")
freed=$(( avail_after - avail_before ))
echo
echo "removed ${removed}/${total} target(s)."
if [[ "$freed" -gt 0 ]]; then
  human=$(numfmt --to=iec "$(( freed * 1024 ))" 2>/dev/null || echo "${freed}K")
  echo "space freed: ${human} (df available ${avail_before}K -> ${avail_after}K)"
else
  echo "space freed: 0 (df delta not positive; another writer may have consumed space)"
fi
