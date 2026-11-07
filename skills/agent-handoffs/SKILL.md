---
name: agent-handoffs
description: >-
  load before any agent-to-agent transfer: porch rules, the eleven handoff
  rules, spec/review/story pointers, and the fixed delegation prompt wording.
---

# Handoffs

A handoff is a porch note. Porch mcp (`vault_save`, `vault_search`) is the only read and write path for agent-to-agent work on the default path. The prompt to the other agent points at the note title. The substance is in the note. Save and load mechanics are in `../doctrine-plan/references/shared-services.md`.

The title is the path: `sessions/<session>/<file>`. `<session>` is one id for the work. The lead sets it, and every agent on every machine reuses it. Do not put a host name in the path. Do not use a harness id that the other agents do not have.

Three types. The file name starts with the type.

| type | title | writer → reader | carries |
| --- | --- | --- | --- |
| spec | `sessions/<session>/spec-<slug>.md` | lead → scout, implementer, adv_review, the user (simplifier and plan-level adv_review in rigorous mode) | an implementable plan with a definition of done |
| review | `sessions/<session>/review-<slug>.md` (split reviews: `review-<slug>-s<n>.md`) | simplifier or adv_review → lead | findings: blockers, nitpicks, others; one round appended per pass |
| story | `sessions/<session>/story-<slug>.md` | the user or an agent → a lead | a product goal or a session continuation that must become specs |

One `<slug>` per scope. Spec and review are living documents: agents pass them on and append; the history stays. A story is written in stone.

Not a handoff: a chat reply to the user. The implementer's return is a `## log` entry in the spec plus the diff. Research and experiment findings use the same session folder naming in `references/handoff-formats.md`.

## rules

1. **the porch note is the handoff. the prompt is a pointer.** the prompt, and any description or title field beside it, is the fixed wording: role, porch note title, the `split s<n>` slot when the spec has splits, working directory and branch, return channel, style line. nothing else.
2. **self-contained.** the reader works from the file alone. never write "see chat".
3. **context-fed.** absolute paths, line ranges, snippets, diffs, and concrete edits the writer is sure of.
4. **one linear pass.** connect later appends to the flow.
5. **never commit a handoff.** never put one in a pr.
6. **sensitive data and secrets.** name where a secret lives; never carry the value.
7. **lowercase asd-ste100.** short sentences. no padding.
8. **receiving:** read in full. check premises. if a premise fails, stop and ask the user.
9. **status lives in the file.** `status: draft`, `status: fast by lead <date>`, or `status: approved by the user <date>`. an implementer does not start on a draft.
10. **spec and review are living documents; a story is written in stone.** append under `## log`; never delete history. goal, changes, or out of scope edits after approval need the user to re-approve.
11. **local handoffs** are a declared machine mode. see `references/local-receipts.md`.

## formats and prompts

Load `references/handoff-formats.md` for the spec, review, story templates and `## prompt shape`. Load `references/local-receipts.md` for local machine prompt wording.
