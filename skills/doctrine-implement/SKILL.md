---
name: doctrine-implement
description: >-
  load at engineering loop step 5, when the spec has a status line and the lead
  hands each split to an implementer: how to brief, supervise, and converge
  each split diff with one author.
---

# Implement

Role choice. When the host's delegation table has `implementer_light`, the lead picks the role per split by the work. Straightforward file edits, where the spec gives each change, go to `implementer_light`. Anything that needs thinking or decisions goes to `implementer`. If in doubt, use `implementer`. When the host has no `implementer_light`, use `implementer`. `implementer_light` follows every `implementer` rule here and in `agent-handoffs`: it starts only on a spec with a status line, returns a `## log` entry, and fixes the `adv_review` blockers on its own diff.

## splits

start every split's implementation subagent (the role from the role choice above) in the same turn, one call per split, with the model from the delegation table. do not wait for one split to return before you start the next. the lead's job is maximal swarming: every split runs at once, and each member builds and self-verifies its split. each prompt is the `agent-handoffs` pointer with the `split s<n>` slot. each implementer works only in its own worktree, on its own branch `agent-<slug>-s<n>`, and edits only the files its split owns. an implementer that needs a change in a file it does not own stops and asks the lead. each implementer fixes the blockers of its own split.

each author writes or updates the tests for its change, runs them, and proves the split works. proof is analytic evidence from real exercise of the written code path: screenshots for ui, e2e runs, real command runs, or run simulations with captured output. a passing test alone is not proof of behavior. the return log includes `tests:` and `proof:` per the spec return format. missing tests or proof stops the split and returns evidence to the lead.

Default authoring path: `implementer` writes the implementation from the spec (approved and simplified in rigorous mode; the lead's plan in fast mode); `adv_review` reviews each split diff adversarially. Only hand-write code yourself when the user explicitly directs it.

- **Writing:** hand `implementer` the spec file; supervise the run.
- **Reviewing:** the lead supervises and checks each proof. `adv_review` audits code, tests, test runs, and proof. trust, but verify analytically. diff reviews stay in the `agent-handoffs` review format. Charge the reviewer with the same simplification hunt, not just correctness: a smaller correct diff that still delivers the ask is a blocker-level finding, not a nitpick.
- **Fixing findings:** `implementer` (the author) addresses the blockers `adv_review` surfaces, so one author converges the diff. Do **not** fall into a write → review → fix → re-review ping-pong across models: keep the write *and* fix loop inside `implementer`, with `adv_review` reviewing.

**Brief delegates as context-fed subagents, not context-hunters.** By the time you delegate (to the implementer, the adv_reviewer, or a cursor run), you have already read the files, traced the path, and gathered the diffs. Hand all of it over: the exact files in play with paths, the relevant line numbers, the current code snippets, the diff so far, and any concrete edits you already know need making. Do **not** self-censor line numbers or code snippets, write them. The old rule that treated a line-number or a code snippet as "dictating" is retired: your job is to spare the delegate from re-discovering what you already know confidently. Direct it to trust the context you provide and to grep/find/read only when it genuinely needs something you did not give it, never to re-survey the codebase from zero. Re-deriving known facts is wasted latency and tokens. You stay responsible for the result: leaving room for the delegate's judgment on what you're *unsure* of is fine, but hand it everything you're *sure* of.

**Match reasoning effort to the task; the floor is medium.** Do not reflexively pin `high`. Medium is the default for routine implementation and review. Reserve `high` for genuinely tricky work, concurrent/race-sensitive, type-heavy, or subtle-invariant changes. Judge per task, not by habit.

You stay the technical lead throughout: frame the briefs, triage findings, check each proof, verify the diff, and exercise the failure mode end-to-end yourself. own the PR and rollout. trust, but verify analytically. Delegating the typing to a sub-agent never delegates responsibility for the result.
