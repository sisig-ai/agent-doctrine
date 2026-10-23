---
name: doctrine-plan
description: >-
  load at engineering loop steps 3 and 4, before any code change: clear the
  tenets gate in the transcript, write the spec to porch with its splits, and
  run the plan loop for the session mode (fast or rigorous).
---

# Tenets gate and plan loop

order: scout findings first (`doctrine-scout`), then the gate, then the spec with `## splits`.

## step 3: tenets gate

answer all fifteen questions in `TENETS.md` **in the transcript**, with evidence. mental clearance is invalid. the lead writes the gate after the scout returns and before the plan loop, and carries it into the brief so the implementer clears it too. required in both modes.

## step 4: plan with splits

### write the spec

write the spec to porch (`sessions/<session>/spec-<slug>.md`). read `HANDOFFS.md` from the current host's doctrine location in full before you write it. the spec status line reads `status: fast by lead <date>` or `status: approved by the user <date>`.

### splits

plan the work as independent splits that run concurrently.

- at most 3 splits. more only when the complexity calls for it or the change spans many files, and the spec says why. one split is fine for a small change.
- each split owns a disjoint set of files. no file is in two splits.
- a split may not change an interface (function signature, schema key, file name, cli flag) that another split reads. the spec fixes shared interfaces before implementation.
- each split runs in its own git worktree on branch `kp-<slug>-s<n>` off the same base commit. the lead creates the worktrees.
- one spec file holds all splits under `## splits`. each split gets its own review file `review-<slug>-s<n>.md`.
- all splits must be sound before consolidation (`doctrine-consolidate`).

### plan loop by mode

- **fast:** hand the spec to the implementation role (`doctrine-implement`) directly, one per split, all started in the same turn. No `simplifier`, no plan-level `adv_review`, no approval wait.
- **rigorous:** `simplifier` → `adv_review` (2 to 3 turns) → surface to the user → **wait for the user’s approval**; mark the spec approved.

## plan mode

`adv_review` means **adversarial review** (hostile-but-fair critique). It is **not** "advanced review."

The plan loop follows the session mode set at session start.

**Rigorous mode.** Before surfacing any plan to the user: (1) write the spec file, (2) start `simplifier` as a subagent on it to strip it to the smallest-correct change and drop speculative scope, fold in the simplifications you accept, then (3) start `adv_review` as a subagent on the simplified plan (`doctrine-review`) for 2 to 3 turns of adversarial review with the current host's required review mechanism. Point `adv_review` at the spec, whole, including the split boundaries; it already carries files, line ranges, current code, and diffs, so the reviewer critiques rather than hunts; default to medium reasoning effort, bumping to high only for genuinely subtle plans. Brief `adv_review` to be critical but helpful, adversarial in service of the plan, not contrarian for sport. Focus on blockers (correctness, architecture, missed constraints, hidden coupling, wrong abstraction, broken assumptions). Charge `adv_review` to pursue aggressive simplification as a first-class tenet equal to correctness, the smaller correct changeset (fewer files, endpoints, abstractions, less new code/state/deps, reuse what exists) that still delivers the ask; unnecessary complexity is itself a blocker, not a nitpick.

`adv_review` appends a round to the review file in the `HANDOFFS.md` format: `### blockers`, `### nitpicks`, `### others` under `## round <n>`, never blended. If it blends them, push back and ask for the split.

Iterate until `adv_review` agrees the plan is sound. Only then surface it to the user. If `adv_review` raises a blocker you disagree with, argue it out with `adv_review` first; do not punt the disagreement up to the user unprocessed.

After the user approves the plan, default to delegating the implementation to `implementer` (see the `doctrine-implement` skill), don't hand-write it yourself unless the user explicitly directs otherwise.

**Fast mode.** Write the spec file and hand it straight to `implementer`; skip `simplifier` and the plan-level `adv_review`, and do not wait for the user's approval. The diff-level `adv_review` (the `doctrine-review` skill) still runs.
