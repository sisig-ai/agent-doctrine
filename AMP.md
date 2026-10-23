# amp host rules

this file is the only source for amp tool names, runtime names, checkout behavior, and invocation mechanics. shared doctrine defines policy and quality rules only.

## orb checkout

when amp runs in an ampcode orb, work directly in the repository checkout at the orb workspace root. do not create or use a git worktree. the orb isolates the thread, and its stack uses the workspace-root checkout.

outside an ampcode orb, use the checkout attached to the amp runner. do not create a worktree unless the user explicitly asks for one.

## code search

`semble_search` and `semble_find_related` are direct amp plugin tools. invoke them directly: use `semble_search` first for one local behavioral, architectural, implementation, or “where is this done?” discovery question, then use `semble_find_related` after a result identifies a useful file and line. `tool_search` searches connected MCP servers only; it cannot establish that a direct amp tool is absent. only an error from directly invoking the relevant semble tool establishes semble failure.

use amp `finder` for multi-step searches that must correlate distinct code areas. use exact search for literal strings, symbols, exhaustive caller lists, or test assertions. read a known file directly.

do not repeat a successful semble search with another search tool only to rediscover the same file. if a direct semble invocation errors, report the blocker and halt. do not silently replace it with grep or finder.

## answer style

the local plugin `~/.config/amp/plugins/style-reminder` appends `~/.config/amp/style-reminder.md` after the user's content on every agent turn (`agent.start`). the message is hidden (`display: false`). the sync installs this plugin on local installs only. the hosted global plugin is a separate amp-hosted repo and is not published by this sync.

## delegation

shared doctrine owns the required workflow and role behavior. this file owns amp invocation mechanics.

read `HANDOFFS.md` from the repository checkout root before you write or receive a handoff.

run scout, simplifier, adv_review, and implementer as direct subagents with amp's built-in `task` tool. do not use a plugin delegate, `create_thread`, an agent mode, or an external cli for these roles.

run scout first, before the gate, with amp's `task` tool and its default model. the loop is scout, gate, plan with splits, one implementer per split, all started in the same turn, one adv_review per split, consolidate, ship.

context-feed each task subagent with the exact goal, constraints, relevant files and lines, and current plan or diff. scout reports facts only. the simplifier reviews plans only. the implementer writes the approved change and fixes review blockers. the adv_review subagent reviews plans and diffs and must append a round in the `HANDOFFS.md` review format.

amp has no skill tool for the loop skills. read a loop skill from `~/.claude/skills/<name>/SKILL.md`, in full, before its step, and read `doctrine-review` before each adv_review task call.

before each adv_review task call, write `runtime: amp-task-subagent` in the transcript. if task is unavailable or fails, report the blocker and halt without a fallback.
