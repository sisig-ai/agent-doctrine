# codex host rules

## doctrine paths

read `~/.codex/TASTE.md`, `~/.codex/TENETS.md`, and `~/.codex/LOCAL.md` at session start. read each file fully.

`~/.codex/AGENTS.md` is generated from shared doctrine, this overlay, and `delegation.toml`. do not edit it by hand.

read `~/.codex/HANDOFFS.md` in full before you write or receive a handoff.

## answer style

the sync installs a `UserPromptSubmit` hook in `~/.codex/hooks.json` that adds `~/.codex/style-reminder.md` to every prompt. codex runs it only after you trust it once in `/hooks`. follow it.

## delegation

use codex's native subagent mechanism for all roles in the generated delegation table. use the exact model and runtime in that table.

run `scout` first. load the `doctrine-scout` skill before you brief it.

before `adv_review`, load the `doctrine-review` skill and write `runtime: codex-subagent` in the transcript.

## checkout isolation

use a git worktree for implementation, review, and deploy operations unless the user explicitly directs work in the primary checkout.

## external cli agents

if an approved plan requires an external cli agent, start it detached. write its brief and final result to porch (`sessions/<session>/agent-notes-<id>.md` or `agent-findings-<id>.md`). a temp local file is allowed only so the process can exit. save it to porch and delete the temp. redirect raw output to a temp log. do not read that log unless the porch note is missing or incomplete.

porch mcp is `[mcp_servers.porch]` in `~/.codex/config.toml`: url `https://porch.sh/mcp`, `bearer_token_env_var = "PORCH_MCP_TOKEN"`.

never use `codex review`. when codex cli is explicitly required, use `codex exec` with an explicit prompt and close stdin. never pass `--base`, `--uncommitted`, or `--commit`.
