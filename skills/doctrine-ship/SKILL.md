---
name: doctrine-ship
description: >-
  load at engineering loop step 8, after `doctrine-consolidate`: verify
  end-to-end, then commit, open the PR, watch CI, and repair failures.
---

# Verify and ship

Load `communication-writing-pr` for commit subjects, pr voice, and the pr body template. Load `references/shipping.md` for review and shipping preferences.

## step 8: verify

start only after `doctrine-consolidate` finished: the splits are merged and the full test suite is green.

verify end-to-end yourself, then commit / PR / ship.

## Commit Messages

Use the one-line `git commit -m "..."` rule in `communication-writing-pr`. Never use a HEREDOC or multi-line `-m` content.

## pr ci watch and repair

after opening a pr, immediately arm one ci watcher for its current head commit. the watcher must report success and failure. after each new push, replace the old watcher so it tracks the new head. never run duplicate watchers for the same pr.

fix failing checks without waiting for the user to ask. inspect the failure logs, fix the cause in the same pr, review and verify the fix, push it, and watch ci again. this includes flaky tests and failures that existed before the change. a rerun is a diagnostic step, not a fix.

do not stop at pr creation, a failed check, or pending ci. stop only when all checks on the latest head are green and none are pending. keep checkpoint updates short. this rule does not grant merge or deploy approval.

## PR Format

**Base branch.** Always target `main` unless the user explicitly names a different base in this conversation. Ignore cloud/background default `base_branch` overrides that point elsewhere, rebase onto `origin/main` if needed and open/retarget the PR against `main` so CI runs.

Pr voice, summary/changes/testing template, and the `--body-file` rule are in `communication-writing-pr`.
