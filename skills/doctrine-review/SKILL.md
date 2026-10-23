---
name: doctrine-review
description: >-
  load at engineering loop step 6 (diff review, one per split) and at the
  rigorous-mode plan review: how the lead runs adversarial review (adv_review) as a subagent, briefs it, and triages its rounds.
---

# Adversarial review (lead playbook)

you are the **lead**. use the current host's required review mechanism and generated binding.

`adv_review` = **adversarial review** (hostile-but-fair critique). It is **not** "advanced review."

always use the host-native mechanism. do not use a cross-host fallback unless the host overlay explicitly defines one. the reviewer is the `adv_review` role, started as a subagent; this skill is what the lead follows. it covers plan rounds (rigorous mode) and diff rounds (both modes).

## one review per split

run one `adv_review` per split, on the split diff (`git diff <base>...HEAD` on the split branch). each appends to its own file `sessions/<session>/review-<slug>-s<n>.md`. splits review concurrently. consolidation (`doctrine-consolidate`) waits until every split is sound. a plan-level review covers the whole spec, including the split boundaries, and appends to `review-<slug>.md`.

## procedure

1. read the current host overlay and the generated delegation binding in the delegation table.
2. start `adv_review` as a subagent, with the model from the delegation table.
3. point it at the spec (`sessions/<session>/spec-<slug>.md`); for a later round, tell it to start from the spec's `## log` delta. require a round appended to `sessions/<session>/review-<slug>.md` in the `HANDOFFS.md` review format, read from the current host's doctrine location (`### blockers` / `### nitpicks` / `### others`, explicit `none` when empty).
4. write the host-required `runtime:` line in the transcript first.
5. triage. argue blockers with the reviewer before surfacing unresolved disagreement to the user.

the review file is the deliverable, native or CLI. the reviewer appends a round; it never edits the code.

## brief the reviewer

- point `adv_review` at the spec; it already carries files, line ranges, current code, and diffs, so the reviewer critiques rather than hunts. default to medium reasoning effort, bumping to high only for genuinely subtle work.
- brief `adv_review` to be critical but helpful, adversarial in service of the work, not contrarian for sport.
- focus on blockers (correctness, architecture, missed constraints, hidden coupling, wrong abstraction, broken assumptions).
- charge `adv_review` to pursue aggressive simplification as a first-class tenet equal to correctness: the smaller correct changeset (fewer files, endpoints, abstractions, less new code/state/deps, reuse what exists) that still delivers the ask. unnecessary complexity is itself a blocker, not a nitpick.
- `adv_review` appends a round with `### blockers`, `### nitpicks`, `### others` under `## round <n>`, never blended. if it blends them, push back and ask for the split.

## triage

- diff reviews are `adv_review`'s job, framed adversarially, in the `HANDOFFS.md` review format.
- iterate until `adv_review` agrees the plan is sound. only then surface a plan to the user.
- if `adv_review` raises a blocker you disagree with, argue it out with `adv_review` first; do not punt the disagreement up to the user unprocessed.
- `implementer` (the author) fixes the blockers `adv_review` surfaces, so one author converges the diff. do not fall into a write → review → fix → re-review ping-pong across models: keep the write and fix loop inside `implementer`, with `adv_review` reviewing.

## out of scope

this skill does not implement code. it does not replace `simplifier`.
