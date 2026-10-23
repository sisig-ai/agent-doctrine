---
name: doctrine-consolidate
description: >-
  load at engineering loop step 7, after every split passed its adv_review:
  merge the split branches, run the full test suite, route post-merge edits to
  an implementer, then ship.
---

# Consolidate

you are the **lead**. start only when every split is sound in its `review-<slug>-s<n>.md`.

## procedure

1. commit each split in its own worktree, one subject line (commit rules in `doctrine-ship`). implementers do not commit.
2. check out the base branch `agent-<slug>` in its worktree.
3. for each split branch, in order: `git merge --no-ff agent-<slug>-s<n>`.
4. a conflict stops the loop. the splits were not file-disjoint. abort the merge, report the conflicting files, and re-plan with `doctrine-plan`. never resolve a conflict by hand.
5. run the full test suite on the merged branch. a failure halts the build.
6. any edit after the merge (a regenerated file, a fixture, a test fix) goes to an implementation subagent, pointed at the spec. one `adv_review` round (`doctrine-review`) covers that delta.
7. remove the split worktrees after the merge.
8. load `doctrine-ship`.

## out of scope

this skill never hand-rewrites a merged diff. it commits only the split branches. `doctrine-ship` commits the rest and opens the pr.
