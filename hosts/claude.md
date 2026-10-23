# claude host rules

## doctrine paths

read `~/.claude/TASTE.md`, `~/.claude/TENETS.md`, and `~/.claude/LOCAL.md` at session start. use the read tool without a limit or offset. if a file needs pages, read through eof.

the whole `~/.claude/CLAUDE.md` file is generated from shared doctrine, this overlay, and `delegation.toml`. do not edit it by hand.

read `~/.claude/HANDOFFS.md` in full before you write or receive a handoff.

## answer style

claude misses the shared answer style rules most often: it narrates the path, recaps earlier turns, explains before it answers, uses rare words, uses analogies, and ends on a servile closer. the sync installs a `UserPromptSubmit` hook in `~/.claude/settings.json` that adds `~/.claude/style-reminder.md` to every prompt. follow it.

## delegation

use claude's built-in task or subagent mechanism for all roles in the generated delegation table. use the exact model and runtime in that table.

the claude agents are `simplifier`, `adv-review`, `implementer`, `implementer-light`, and `scout`. spawn each by that name. the model comes from the agent file, which equals the model in the table.

pick the implementation role per the `doctrine-implement` skill.

start the split implementers in one message: one Agent call per split, each with `run_in_background: true`.

run `scout` first. load the `doctrine-scout` skill before you brief it.

before `adv_review`, load the `doctrine-review` skill and write `runtime: claude-agent` in the transcript.

## session harness

set `"crossSessionInbound": "accept"` in `~/.claude/settings.json` at user scope. settings changes apply to new sessions only.

## checkout isolation

use a git worktree for implementation, review, and deploy operations unless the user explicitly directs work in the primary checkout.

## external cli agents

if an approved plan requires an external cli agent, start it detached. write its brief and final result to porch (`sessions/<session>/agent-notes-<id>.md` or `agent-findings-<id>.md`). a temp local file is allowed only so the process can exit. save it to porch and delete the temp. redirect raw output to a temp log. do not read that log unless the porch note is missing or incomplete.

porch mcp is http at user scope: url `https://porch.sh/mcp`, header `Authorization: Bearer` from `PORCH_MCP_TOKEN`.
