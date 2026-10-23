---
name: doctrine-scout
description: >-
  load at engineering loop step 2, before the tenets gate and before any plan:
  write the scout brief, dispatch scout as a subagent first, and read its
  findings.
---

# Scout

you are the **lead**. scout runs first. no gate answer and no plan exists before the findings are read.

## procedure

1. write the brief as a porch spec note: `sessions/<session>/spec-scout-<slug>.md`. it is a reduced spec (see `## spec` in `HANDOFFS.md`): status line, scope, from, `## goal`, `## context`, numbered questions (one fact each), and `## return`. it has no `## gate`, because the gate comes after the scout. add the paths, branch, and prior notes you already know. read `HANDOFFS.md` from the current host's doctrine location in full before you write it.
2. start `scout` as a subagent with the prompt in `HANDOFFS.md` (`## prompt shape`, rule 1). the prompt carries nothing else.
3. scout returns `sessions/<session>/findings-<slug>.md`. load the newest version and read it in full.
4. check the premises you can check (file:line still true, branch exists). then write the tenets gate (`doctrine-plan`).

## roles

- scout does search, fact gathering, log and data queries, and read-only scripts. it reads history (git log, git blame, gh pr list and view), prior porch notes, and docs.
- scout reports facts only, each with file:line or a quoted source. no recommendations, no analysis, no decisions.
- the lead does the analysis and the decisions.

## out of scope

this skill does not write the gate, the spec, or code. scout edits no file.
