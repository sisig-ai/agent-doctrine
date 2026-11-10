# Handoff formats

Moved from `HANDOFFS.md`. Three note types: spec, review, story. The fixed prompt wording is at the end. Store and title rules are in `../SKILL.md`. Store protocol is in `../../doctrine-plan/references/shared-services.md`.

## spec

the plan and the brief are one file. the lead writes it after the scout findings and the gate, before the plan loop. in rigorous mode simplifier and adv_review review it and the user approves it; in fast mode it goes straight to the implementer. one implementer builds each split from it. the diff reviewer checks each split diff against it.

a scout brief (`spec-scout-<slug>.md`) is a reduced spec: status line, scope, from, `## goal`, `## context`, numbered questions, and `## return`. it has no `## gate`, `## definition of done`, or `## changes`, because the gate comes after the scout. the scout returns `findings-<slug>.md`.

```
# spec: <title>

status: draft | fast by lead <date> | approved by the user <date>
scope: <checkout path>, branch <change-slug>
from: <role, model> · <date>

## goal
one sentence. then why, with the evidence (feedback id, log line, number).

## definition of done
numbered observable items. the validation section proves each one.

## gate
the fifteen tenets answers, short, or the exact place they live (transcript date, or this file).

## context
files with absolute paths and line ranges. current code snippets. what exists that does part of the job. what was tried. decisions already made and why (so reviewers do not re-litigate).

## changes
numbered. per file. the concrete edit. code when you know it.

## splits
the independent units that run concurrently, one per seam (rules in `doctrine-plan`). one entry per split: id (`s<n>`), branch `agent-<slug>-s<n>`, worktree path, files owned, the change numbers it carries, its review checks and exact review destination. one split applies only when the task has no seam. shared interfaces are fixed in `## context` (or a `## interfaces` heading) before implementation, so no split changes what another reads.

## constraints
what bounds the solution. what the implementer must not do (commit, push, pr, touch these files).

## out of scope
files and areas not to touch. questions not to answer.

## validation
exact commands and expected results, each keyed to a definition-of-done number. the real-data e2e (workspace, container). the eval baseline run id, or why no build output can change. say if a rebuild would be needed (then stop and ask). each split names its own tests and the proof its implementer must produce.

## review
what the reviewer reads (this file; the diff range on the branch). numbered checks: concrete concerns, invariants, cross-file consistency. 6-12 items.

## return
what the implementer reports: a `## log` entry with files changed, decisions not in this spec, `tests:` (test files written, exact command, exact result) and `proof:` (one item per definition-of-done number: the artifact that exercises the written code path, plus what it does not prove), and, for an external cli, the porch note `sessions/<session>/agent-notes-<id>.md`.

## log
append-only. one entry per event, newest last: `- <date> <role, model>: <what changed or happened>`. approval, each review round folded (sections changed + finding ids answered), implementer start and final, lead decisions, re-approvals. this is the delta a reviewer reads before the next round.
```

the spec is living. the lead may append to `## review` and `## validation` after approval (new diff range, new checks); any agent may append to `## context` and `## log`. a change to `## goal`, `## changes`, or `## out of scope` after approval needs the user to re-approve, logged.

## review

written by simplifier or adv_review. read-only pass on the code; the review file itself is living. one file per slug; each pass appends a round. three sections per round, in this order, always present.

```
# review: <title>

target: sessions/<session>/spec-<slug>.md

## round <n>: simplifier | adv_review plan | adv_review diff
runtime: claude-agent claude-opus-5-5 | codex-subagent gpt-6.1-sol | cursor-subagent <model> · <date>
diff: git diff main...HEAD @ <sha> (diff rounds)
verdict: sound | not yet, <n> blockers, <n> nitpicks. premises checked | premise <x> failed.

### blockers
`none` when empty, plus one sentence. else one item per finding, ranked by leverage:
- b<n> · check <n> or spec §: file:line. what is wrong. why it blocks. the smaller or correct alternative.

### nitpicks
`none` when empty. same shape. ignorable: style, naming, micro, taste.

### others
everything that is not a finding. adv_review: confirmed-ok lines keyed to the check numbers; earlier blockers now closed (`b1 closed: <how>`). simplifier: the ask in one sentence (the yardstick), and keep-as-is (complexity the ask requires). `none` when empty.
```

a later round starts by reading the spec's `## log` entries since its last round, then marks earlier blockers closed or still open under its `### others`; it does not edit earlier rounds. the lead may append a dated `- lead: <decision>` line under a round when it accepts or rejects a finding. a blocker is: wrong behavior, a missed constraint, hidden coupling, wrong abstraction, a broken assumption, a swallowed error or silent fallback, a dropped scope item, complexity that is not earned, missing or weak tests, missing or invalid proof. unearned complexity is a blocker, not a nitpick. a nitpick is ignorable. never blend the lists. every finding cites evidence (file:line, quoted text). the reviewer does not edit the code.

## story

a product goal in jira shape. the user writes it, or an agent writes it for a lead (a triage that found a workstream, a research result, a transplanted session). the reader turns it into one or more specs. a story does not replace a spec. a story is written in stone: no edits after it is written; a change of goal is a new story file.

```
# story: <title>

from: the user | <role, model> · <date>

## user story
as a <user role>, i want <what>, so that <why>. evidence: feedback ids, numbers, prs. no confidential data or personal identity.

## acceptance criteria
numbered. observable from the user's side. what the user will check.

## definition of done
numbered. the engineering facts that must be true: specs written and shipped, tests, evals, rollout, docs.

## context (optional; agent-written stories and continuations)
where we are: branch, commits, pr, ci, what was tried and failed, known blockers not fixed, gotchas paid for. rulings the user already made. harness: doctrine reads and the gate, exact commands, containers, paths, stop conditions. open questions for the user. artifacts. one linear pass.
```

## prompt shape

the whole prompt. no more. the bracketed `split s<n>.` slot appears only when the spec has splits, and names the split the reader owns.

```
you are the <role>. load the newest porch note titled sessions/<session>/<file> (vault_search the exact title; if empty, search once more; take the newest createdAt). [split s<n>.] work in <abs path>, branch agent-<slug>. return by vault_save of the full note to that same title [and in-session]. if a premise in the note fails, stop and ask. no mannered prose. answer first, short sentences, numbers and names, end on the result. start.
```
