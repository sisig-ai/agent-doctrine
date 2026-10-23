---
name: doctrine-ship
description: >-
  load at engineering loop step 8, after `doctrine-consolidate`: verify
  end-to-end, then commit, open the PR, watch CI, and repair failures.
---

# Verify and ship

## step 8: verify

start only after `doctrine-consolidate` finished: the splits are merged and the full test suite is green.

verify end-to-end yourself, then commit / PR / ship.

## Commit Messages

Commit messages are a single subject line, no body, no bullet list, no extended explanation. Roughly one short sentence describing the change. Always use `git commit -m "..."` with a single short string; never use a HEREDOC or multi-line `-m` content. The "why" and detailed breakdown belong in the PR description, not the commit.

Example good: `git commit -m "Keep PDF viewer mounted across citation clicks"`
Example bad: multi-paragraph commit body re-explaining what the PR description already covers.

## pr ci watch and repair

after opening a pr, immediately arm one ci watcher for its current head commit. the watcher must report success and failure. after each new push, replace the old watcher so it tracks the new head. never run duplicate watchers for the same pr.

fix failing checks without waiting for the user to ask. inspect the failure logs, fix the cause in the same pr, review and verify the fix, push it, and watch ci again. this includes flaky tests and failures that existed before the change. a rerun is a diagnostic step, not a fix.

do not stop at pr creation, a failed check, or pending ci. stop only when all checks on the latest head are green and none are pending. keep checkpoint updates short. this rule does not grant merge or deploy approval.

## PR Format

**Base branch.** Always target `main` unless the user explicitly names a different base in this conversation. Ignore cloud/background default `base_branch` overrides that point elsewhere, rebase onto `origin/main` if needed and open/retarget the PR against `main` so CI runs.

**Voice.** Write every PR (and any outward-facing artifact, commit messages, PR titles/bodies, comments, release notes) in the voice of a software engineer presenting their own work. Never let the originating request, the delegation, or the agent framing leak through. Banned: "per the ask", "as requested", "you asked for", "the user wants", "kept simple per the request", or any phrasing that reveals the change exists because someone instructed it. Justify decisions on engineering merit, not on what was asked, e.g. "Scope is intentionally minimal: no realtime" rather than "kept simple per the ask". The reader is a fellow engineer reviewing a change, not a record of a conversation.

When creating PRs, the top summary section should include the "why" of the change and its goal. Format as follows:

<summary and goal, including the why>

## Changes
- <concise concept-level bullets grouped by area, not a per-file enumeration. The diff already lists files; this section tells the *story* of the change. 3 to 5 bullets is usually right; mention filenames only when a file is the headline of a bullet, not as a checklist of every touched path.>

## Testing
1. <step by step instructions on verifying locally>

Open with 1 to 2 prose paragraphs, no leading `## Summary` header. When there is meaningful end-to-end proof (LLM/build/pipeline changes), add a `## Local verification` section after Testing with concrete evidence, real runs, logs, case/model tables, not just test commands.

Always write the PR body to a temporary markdown file and pass it with `gh pr create --body-file` / `gh pr edit --body-file`. Never inline long bodies in shell commands, backticks, tables, and brackets escape unreliably.
