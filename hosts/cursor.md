# cursor host rules

## doctrine paths

read `~/.cursor/TASTE.md`, `~/.cursor/TENETS.md`, and `~/.cursor/LOCAL.md` at session start. read each file fully.

`~/.cursor/rules/doctrine.mdc` is generated from shared doctrine, this overlay, and `delegation.toml`. do not edit it by hand.

read `~/.cursor/HANDOFFS.md` in full before you write or receive a handoff.

## answer style

the sync installs `sessionStart`, `postToolUse`, and `postToolUseFailure` hooks in `~/.cursor/hooks.json` that add `~/.cursor/style-reminder.json` to context. this covers session start and turns that call a tool. cursor user hooks do not load in cloud agents, and tool-free follow-up turns get no reminder. follow it.

## delegation

use cursor's built-in task or subagent mechanism for all roles in the generated delegation table. use the exact model and runtime in that table.

run `scout` first. load the `doctrine-scout` skill before you brief it.

before `adv_review`, load the `doctrine-review` skill, use the `adv-review` agent, and write `runtime: cursor-subagent` in the transcript.

## checkout isolation

use a git worktree for implementation, review, and deploy operations unless the user explicitly directs work in the primary checkout.

## external cli agents

if an approved plan requires an external cli agent, start it detached. write its brief and final result to porch (`sessions/<session>/agent-notes-<id>.md` or `agent-findings-<id>.md`). a temp local file is allowed only so the process can exit. save it to porch and delete the temp. redirect raw output to a temp log. do not read that log unless the porch note is missing or incomplete.

porch mcp is http in `~/.cursor/mcp.json`: url `https://porch.sh/mcp`, header `Authorization: Bearer ${env:PORCH_MCP_TOKEN}`. enable it with `cursor-agent mcp enable porch`.
