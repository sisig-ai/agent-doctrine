---
name: communication-writing-pr
description: >-
  load for pr titles, pr bodies, and commit messages: voice, banned phrases,
  the summary/changes/testing template, the --body-file rule, and the
  one-line commit rule.
---

# PR and commit prose

load `communication-voice` first for substantial prose. load `doctrine-ship` for the git operations (verify, commit, open the pr, watch ci).

## Commit Messages

Commit messages are a single subject line, no body, no bullet list, no extended explanation. Roughly one short sentence describing the change. Always use `git commit -m "..."` with a single short string; never use a HEREDOC or multi-line `-m` content. The "why" and detailed breakdown belong in the PR description, not the commit.

Example good: `git commit -m "Keep PDF viewer mounted across citation clicks"`
Example bad: multi-paragraph commit body re-explaining what the PR description already covers.

## PR voice and format

**Voice.** Write every PR (and any outward-facing artifact, commit messages, PR titles/bodies, comments, release notes) in the voice of a software engineer presenting their own work. Never let the originating request, the delegation, or the agent framing leak through. Banned: "per the ask", "as requested", "you asked for", "the user wants", "kept simple per the request", or any phrasing that reveals the change exists because someone instructed it. Justify decisions on engineering merit, not on what was asked, e.g. "Scope is intentionally minimal: no realtime" rather than "kept simple per the ask". The reader is a fellow engineer reviewing a change, not a record of a conversation.

When creating PRs, the top summary section should include the "why" of the change and its goal. Format as follows:

<summary and goal, including the why>

## Changes
- <concise concept-level bullets grouped by area, not a per-file enumeration. The diff already lists files; this section tells the *story* of the change. 3 to 5 bullets is usually right; mention filenames only when a file is the headline of a bullet, not as a checklist of every touched path.>

## Testing
1. <step by step instructions on verifying locally>

Open with 1 to 2 prose paragraphs, no leading `## Summary` header. When there is meaningful end-to-end proof (LLM/build/pipeline changes), add a `## Local verification` section after Testing with concrete evidence, real runs, logs, case/model tables, not just test commands.

Always write the PR body to a temporary markdown file and pass it with `gh pr create --body-file` / `gh pr edit --body-file`. Never inline long bodies in shell commands, backticks, tables, and brackets escape unreliably.
