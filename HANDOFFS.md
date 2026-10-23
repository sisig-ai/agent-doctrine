# handoffs

a handoff is a porch note. porch mcp (`vault_save`, `vault_search`) is the only read and write path for agent-to-agent work. it is the only way to pass work between agents, not chat, not a task prompt body, not a repo-local file. the prompt to the other agent points at the note title. the substance is in the note. save and load mechanics are in the porch section of `CLAUDE.md`.

the title is the path: `sessions/<session>/<file>`. `<session>` is one id for the work. the lead sets it, and every agent on every machine reuses it. do not put a host name in the path. do not use a harness id that the other agents do not have. save and load follow the porch section in the shared doctrine. `vault_save` inserts a new note. the current text is the exact title with the newest `createdAt`.

three types. the file name starts with the type.

| type | title | writer → reader | carries |
| --- | --- | --- | --- |
| spec | `sessions/<session>/spec-<slug>.md` | lead → scout, implementer, adv_review, the user (simplifier and plan-level adv_review in rigorous mode) | an implementable plan with a definition of done |
| review | `sessions/<session>/review-<slug>.md` (split reviews: `review-<slug>-s<n>.md`) | simplifier or adv_review → lead | findings: blockers, nitpicks, others; one round appended per pass; later rounds start from the spec's `## log` delta |
| story | `sessions/<session>/story-<slug>.md` | the user or an agent → a lead | a product goal or a session continuation that must become specs |

one `<slug>` per scope. spec and review are living documents: agents pass them on and append; the history stays. a story is written in stone.

## rules

1. **the porch note is the handoff. the prompt is a pointer.** the prompt, and any description or title field beside it, is the fixed wording in `## prompt shape`: role, porch note title, the `split s<n>` slot when the spec has splits, working directory and branch, return channel, style line. nothing else. the role slot is the role name only. if the reader needs a fact, it goes in the note. a prompt that carries context, code, line numbers, checks, or constraints is a doctrine miss.
2. **self-contained.** the reader works from the file alone. copy what the reader needs into the file. a handoff may name another handoff as required reading; that is substance. any other link is provenance. never write "see chat".
3. **context-fed.** the writer has read the files. the file carries absolute paths, line ranges, current code snippets, diffs, and the concrete edits the writer is sure of. tell the reader to trust the file and to search only for what is not in it.
4. **one linear pass.** a reader goes top to bottom once. when you append later work, connect it to the flow. decision rules come after the events that produced them.
5. **never commit a handoff.** never put one in a pr. do not keep a second copy under `.scratch/` or `~/agent-research`.
6. **sensitive data and secrets.** shared handoffs contain no secrets, personal identifiers, or confidential customer content. keep restricted inputs in approved storage and name their location. a handoff names where a secret lives (environment variable or path); it never carries the value.
7. **lowercase asd-ste100.** short sentences. no padding.
8. **receiving a handoff:** read it in full, no truncation. check the premises you can check (file:line still true, branch exists, numbers match). if a premise fails, stop and ask the user. do not improvise.
9. **status lives in the file.** a spec says `status: draft`, `status: fast by lead <date>`, or `status: approved by the user <date>`. an implementer does not start on a draft.
10. **spec and review are living documents; a story is written in stone.** any agent that holds a spec or review may append to it: new context, a decision, a result, a closed blocker. the paper trail stays: never delete or rewrite history; update a status line or a checkbox in place, put everything else in a dated, signed entry under `## log`. a fold entry names the sections changed and the finding ids it answers (`b2 → §9 reordered`), so the next round reads the delta in the log instead of re-diffing the file or trusting "this is round n". a change to `## goal`, `## changes`, or `## out of scope` after approval needs the user to re-approve (log it). a story is never edited after it is written; a new story is a new file.
11. **local handoffs are a declared machine mode.** a machine whose `LOCAL.md` declares the local handoff override (`does not require porch`) may store handoffs as local files and use `handoff.ts`. other machines keep the porch rules above unchanged. on a local machine, a delegation carries exactly one structured pointer line, `handoff: {"note":"<abs note path>"}`; the host overlay defines the enforcement adapter. `handoff.ts` writes authored `exact` and `prose` blocks unchanged by default and makes zero model calls. an explicit `--compress` request compresses `prose` blocks once through the same native harness. it writes a local receipt bound to the absolute path, rule version, revision, harness, model, content hash, and the last delta's processing mode (`authored` or `native-compressed`). the receipt certifies storage integrity and the declared processing path; it does not certify concision, semantic quality, or author identity. enforcement is local to that machine. install it with `doctrine-sync install-handoff-local`; ordinary sync deploys the core only. unsupported hosts report a concrete gap through `doctrine-sync handoff-capabilities`. this covers ordinary agent workflows; a same-user shell can edit the note or drop a receipt, so it is not a security boundary. compression prompt adapted from wilpel/caveman-compression.

not a handoff: a chat reply to the user. the implementer's return is a `## log` entry in the spec (files changed, decisions not in the spec, test output) plus the diff; the external-cli status note `sessions/<session>/agent-notes-<id>.md` stays for progress polling only. research, probes, and experiment findings use the same session folder: `research-<topic>.md`, `probe-<slug>.md`, `findings-<slug>.md`.

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
the independent units that run concurrently (rules in `doctrine-plan`). one entry per split: id (`s<n>`), branch `kp-<slug>-s<n>`, worktree path, files owned, the change numbers it carries, its review checks. a small change has one split. shared interfaces are fixed in `## context` (or a `## interfaces` heading) before implementation, so no split changes what another reads.

## constraints
what bounds the solution. what the implementer must not do (commit, push, pr, touch these files).

## out of scope
files and areas not to touch. questions not to answer.

## validation
exact commands and expected results, each keyed to a definition-of-done number. the real-data e2e (workspace, container). the eval baseline run id, or why no build output can change. say if a rebuild would be needed (then stop and ask).

## review
what the reviewer reads (this file; the diff range on the branch). numbered checks: concrete concerns, invariants, cross-file consistency. 6-12 items.

## return
what the implementer reports: a `## log` entry (files changed, decisions not in this spec, test output) and, for an external cli, the porch note `sessions/<session>/agent-notes-<id>.md`.

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

a later round starts by reading the spec's `## log` entries since its last round, then marks earlier blockers closed or still open under its `### others`; it does not edit earlier rounds. the lead may append a dated `- lead: <decision>` line under a round when it accepts or rejects a finding. a blocker is: wrong behavior, a missed constraint, hidden coupling, wrong abstraction, a broken assumption, a swallowed error or silent fallback, a dropped scope item, or complexity that is not earned. unearned complexity is a blocker, not a nitpick. a nitpick is ignorable. never blend the lists. every finding cites evidence (file:line, quoted text). the reviewer does not edit the code.

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
you are the <role>. load the newest porch note titled sessions/<session>/<file> (vault_search the exact title; if empty, search once more; take the newest createdAt). [split s<n>.] work in <abs path>, branch <kp-slug>. return by vault_save of the full note to that same title [and in-session]. if a premise in the note fails, stop and ask. no mannered prose. answer first, short sentences, numbers and names, end on the result. start.
```

## prompt shape (local machine)

on a machine that declares the local handoff override, the handoff is a local file. the prompt is the fixed wording in `## prompt shape`, with the porch load replaced by the local path, and carries exactly one pointer line:

```
handoff: {"note":"<abs note path>"}
```

the host overlay names the enforcement adapter. nothing else in the prompt changes.
