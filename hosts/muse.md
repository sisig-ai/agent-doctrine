# muse host rules

## doctrine paths

read `~/.config/muse/TASTE.md`, `~/.config/muse/TENETS.md`, and `~/.config/muse/LOCAL.md` at session start. read each file fully.

`~/.config/muse/AGENTS.md` is generated from shared doctrine, this overlay, and `delegation.toml`. do not edit it by hand.

read `~/.config/muse/HANDOFFS.md` in full before a handoff.

## delegation

use muse native subagents for all roles in the generated delegation table. use the exact model and runtime in that table. pass the model on the subagent or workflow agent call where the tool exposes a model argument.

muse has no `implementer_light`. do not spawn that role.

run `scout` first. read the `doctrine-scout` skill before you brief it.

muse has no skill tool. read a loop skill from `~/.config/muse/skills/<name>/SKILL.md`, in full, before its step.

before `adv_review`, read the `doctrine-review` skill and write `runtime: muse-subagent` in the transcript.

## checkout isolation

use a git worktree for implementation, review, and deploy unless the user directs the primary checkout.

## external cli agents

porch is the handoff path. if porch is down, stop. do not copy another harness mcp file.
