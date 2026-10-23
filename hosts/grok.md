# grok host rules

## doctrine paths

read `~/.grok/TASTE.md`, `~/.grok/TENETS.md`, and `~/.grok/LOCAL.md` at session start. read each file fully.

`~/.grok/rules/doctrine.md` is generated from shared doctrine, this overlay, and `delegation.toml`. do not edit it by hand.

read `~/.grok/HANDOFFS.md` in full before a handoff.

`~/.claude/CLAUDE.md` and `~/.cursor/rules/doctrine.mdc` load after `~/.grok/rules` while compat agents and rules are true. sync sets `[compat.claude]` agents and rules false, and `[compat.cursor]` agents and rules false. skills, mcps, and hooks stay as they are.

## delegation

delegation uses `spawn_subagent` and the agent name. map `adv_review` to `adv-review`. `scout`, `simplifier`, and `implementer` use those names. the model comes from the agent file. do not pass a model argument when the tool hides it. do not use a fast variant. do not use `claude-agent`, `codex-subagent`, `cursor-subagent`, or `opencode-subagent`.

grok has no `implementer_light`. do not spawn that role.

run `scout` first. read the `doctrine-scout` skill before you brief it.

grok has no skill tool. read a loop skill from `~/.grok/skills/<name>/SKILL.md`, in full, before its step.

before `adv_review`, read the `doctrine-review` skill and write `runtime: grok-subagent` in the transcript.

## checkout isolation

use a git worktree for implementation, review, and deploy unless the user directs the primary checkout. spawn the implementer with isolation worktree.

## external cli agents

porch is the handoff path. if porch is down, stop. do not copy another harness mcp file.
