---
name: cleanup-worktrees
description: >-
  find and remove git worktrees older than a threshold (default 3 days) across every
  worktree location on this machine, then report what was removed and how much space
  was freed. use when disk fills up from accumulated agent worktrees, or when asked to
  clean up stale worktrees, prune old worktrees, or run "/cleanup-worktrees".
---

# cleanup-worktrees

remove stale git worktrees and report the space reclaimed.

## what it does

1. finds every repo that owns worktrees, lists its registered worktrees, and scans the
   worktree-parent directories for orphan leftovers (a directory with no `.git`).
2. marks a worktree old when its newest file (excluding `.git`) is older than the
   threshold, default 3 days.
3. removes the old ones with `git worktree remove --force`, falling back to
   `sudo rm -rf` + `git worktree prune` when root-owned files (for example docker
   artifacts such as `.next` or `eval_workspace`) block the delete.
4. reports each removed path and the space freed from the `df` delta.

branches are never deleted. the primary checkout is never touched. a worktree with
uncommitted changes is flagged `DIRTY`; removing it discards that work.

## use it

the script is `scripts/cleanup-worktrees.sh` beside this file.

1. scan (dry-run, changes nothing):

   ```bash
   scripts/cleanup-worktrees.sh --days 3
   ```

2. read the list. it prints, per target, the age, size, `DIRTY` count, and path. if any
   target is `DIRTY`, removal discards uncommitted work. show the list to the operator
   and get an explicit yes before deleting; a destructive delete is never implicit.
   `--days N` changes the threshold; `--root DIR` adds a search directory.

3. apply:

   ```bash
   scripts/cleanup-worktrees.sh --days 3 --apply
   ```

4. report the removed paths, the total freed, and the `df` before/after.

## notes

- default is dry-run; nothing is deleted without `--apply`.
- old is judged by the newest file mtime in the worktree, excluding `.git`.
- `sudo` is used only when a plain delete is refused by file permissions.
- orphan leftovers are found only under the operator's home directory. a worktree that
  lives directly under `/tmp` or another shared root is removed only while still
  registered. pass `--root` to widen the search.
