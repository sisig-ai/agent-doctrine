# devin host rules

this file owns devin mechanics. shared doctrine owns policy.

## doctrine paths

Configure Devin's personal rules or project context to read this repository's doctrine. There is no preconfigured organization blueprint or personal rule bundle. Clone your chosen fork to a stable path and read `TASTE.md`, `TENETS.md`, and `HANDOFFS.md` before substantial work. Keep machine-specific context private.

## delegation

devin has no in-session simplifier, adv_review, or implementer subagent, so `delegation.toml` has no devin table. run `scout` first, then `simplifier` and `adv_review`, as child devin sessions. the loop is scout, gate, plan with splits, implement splits, all started in the same turn, one adv_review per split, consolidate, ship. write `runtime: devin-child-session` in the transcript before each adv_review run. a review you write yourself is not an adv_review.

a child session runs on its own machine. it does not see this machine's files. give the child the porch note title (`sessions/<session>/<file>`). the note still carries the substance; the prompt stays a pointer.

devin's own testing agent shares this machine and this checkout. use it for ui-driven testing only, not for review roles.

## checkout isolation

devin clones each repository once under `~/repos/<name>`. keep that checkout on `main` and add a worktree for feature work: `git worktree add ~/repos/<name>-kp-<kebab> -b kp-<kebab> origin/main`.

## pull requests

use devin's built-in git tools for pr create, update, view, checks, and ci logs. `gh` is not always authenticated in a devin session. the built-in pr tool appends a session link to the body; that link is not agent attribution and stays.

## tools

Install `tokensieve` separately if you want compressed command output. use it for supported commands. if it is missing from path, use the raw command and say so.

Install semble separately if you want semantic code search. it has no mcp binding in devin, so use the cli: `semble search "<question>" <path>` and `semble find-related <file> <line> <path>`. use it first for behavior, architecture, and implementation questions. use `rg` for literals, symbols, exhaustive callers, and test assertions.

save research, probes, and experiment findings to porch under the session folder. do not attach them only to the devin session.
