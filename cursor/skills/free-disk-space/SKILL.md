---
name: free-disk-space
description: >-
  profile disk use and reclaim space on the local machine or an explicitly named
  ssh machine. inspect stale cpu and ram processes when cleanup includes them.
  use for disk cleanup, low disk space, or /free-disk-space.
---

# free disk space

measure the named machine, remove authorized disposable data, and report measured results.
keep destructive actions within explicit approval for their exact targets and contents.

## measure before cleanup

- confirm the requested host, user, container boundary, filesystems, and mount roots.
  record `df` used and available bytes, available memory, swap, and current cpu samples.
  use host-appropriate tools; full swap with ample available ram does not establish memory pressure.
- run bounded `du` scans per filesystem, then inspect the largest visible directories.
  select explicit mount roots: `du -x` on a parent skips separate home or docker mounts.
  limit sorted results before returning output. report permission failures and incomplete scans.
- inspect docker's mounted storage root when `docker system df` leaves unexplained usage.
  that command can omit logs and other storage. inspect open deleted files when needed.
  overlapping directory totals and worktree hardlinks cannot establish total reclaimable bytes.
- container `df` can show the shared backing disk. label unexplained usage as unaccounted.
  it does not prove another tenant's usage or provide host access.
  preserve container isolation. request authorized host access only when useful; continue permitted visible cleanup without it.

## reclaim disposable data

- inspect cache purpose and current users before cleanup. use package-manager cleanup commands for regenerable caches within authorization.
  preserve caches used as executables by active processes, including `npx` jobs.
  preserve installed tool versions, database volumes, customer workspaces, histories, and arbitrary temporary trees.
- prune unused docker images within cleanup scope when re-download is acceptable.
  do not blanket-prune volumes or stopped containers, which can retain state.
- never classify directories without `.git` as disposable worktree leftovers.
  agent memory, history, and daemon directories can lack `.git` and remain required.

## remove approved worktrees

1. enumerate registered worktrees and their actual repository owners. preserve primary checkouts and branches.
   inspect age, status including untracked files, and ignored contents that removal would delete.
   check process cwd and command references, plus docker bind mounts.
   age filters candidates; it does not prove inactivity.
2. present a fixed manifest of exact paths, repository owners, and deletion impact, including ignored contents.
   obtain explicit user approval for that manifest before removal.
   never rescan to broaden approved targets or use a broad cleanup helper's apply mode.
3. immediately recheck each target's real path, registration, matching git common directory, status, contents, and activity.
   skip and report changed, active, unregistered, symlink, or primary targets.
   permission failures cannot certify inactivity or unchanged contents.
4. remove only unchanged approved targets with `git worktree remove --force` through their repository owner.
   narrowly scoped `sudo` can handle root-owned build artifacts after the same checks.
   report failures; do not use broad `rm` fallback or prune unrelated registration records.
   preserve every branch.

## stop verified abandoned processes

- inspect pid, user, parent, start identity, command, cwd, descendants, activity, and connections.
  process age or high cpu alone does not establish abandonment.
  a polling watcher can consume substantial cpu while it serves active work.
  stale-process cleanup authorizes verified abandoned jobs; active or uncertain jobs require a user decision.
- check the owning service or container's purpose before a stop. stop that owner when necessary to prevent respawn.
  do not kill parent supervisors indiscriminately.
  a deleted worktree cwd, no children, and no activity support abandonment of shells or preview servers.
- recheck process start identity immediately before each signal to prevent pid reuse errors.
  send `term`, then verify exit. verified unused interactive shells can ignore `term`; use `hup` when appropriate.
  force requires justification and authorization. zombies use no rss and need no repeated kill.
- `/proc` entries can disappear during inspection. tolerate only confirmed process exits.
  treat permission failures and other errors as unresolved evidence, never proof of inactivity.

## report results

report exact removed worktree and stopped process counts, preserved branches, protected targets, failures, and visibility gaps.
repeat measurements on the same filesystems. report actual `df` byte deltas and available disk.
concurrent writers can change net disk deltas; process rss sums remain estimates.
