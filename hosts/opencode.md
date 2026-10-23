# opencode host rules

## doctrine paths

read `~/.config/opencode/TASTE.md`, `~/.config/opencode/TENETS.md`, and `~/.config/opencode/LOCAL.md` at session start. read each file fully.

`~/.config/opencode/AGENTS.md` is generated from shared doctrine, this overlay, and `delegation.toml`. do not edit it by hand.

read `~/.config/opencode/HANDOFFS.md` in full before you write or receive a handoff.

## registered project memory

before substantive work in a git repository or configured shared root, run `doctrine-sync project-memory path` from that root. if it returns a path, do not read `MEMORY.md` in full. discover notes with one bounded search against the index only:

```bash
rg -i -m 10 -- '<task-specific terms>' "$MEMORY_ROOT/MEMORY.md"
```

read only the linked note files from relevant matches. one broader bounded retry (`-m 10`) is allowed if nothing matched; never fall back to loading the entire index. the command returns an absolute `projects/<id>/memory` (use it as `$MEMORY_ROOT`); never read `conflicts/`. no output is normal for an unregistered root. a reported path that cannot be read is an error: stop rather than substituting another source.

for the full agent contract (`project_id`, canonical memory path, and native memory path), run:

```
doctrine-sync project-memory path --json [/path/to/checkout]
```

this emits `{"project_id":"…","canonical_memory":"/abs/…/projects/<id>/memory","native_memory":"/abs/…"}` when registered, or nothing (exit 0) when unregistered.

**writing project memory:** to persist new knowledge, create a new file `agent_note_<slug>.md` under the **native_memory** path from `--json`. never edit existing corpus files unless explicitly merging. never write `feedback_*.md` (those are Claude reflection inputs into global doctrine). native writes are local until `project-memory-preview` + `project-memory-apply`; other machines pick them up via `project-memory-pull`. when you add a note, also append one index line to `MEMORY.md` (`- [title](file.md) — blurb`); do not rewrite unrelated index entries.

`shared:` roots match the exact registered directory only, descendants do not inherit the registration.

## delegation

use opencode's native subagent mechanism for all roles in the generated delegation table. use the exact model and runtime in that table.

launch role subagents by their native agent id: `scout`, `simplifier`, `adv-review`, and `implementer`. use `ai-engineer` or `principal-engineer` for specialist review when the task fits. a role that maps to a delegation entry carries that model; the others inherit the parent session model.

run `scout` first. load the `doctrine-scout` skill before you brief it.

before `adv_review`, load the `doctrine-review` skill and write `runtime: opencode-subagent` in the transcript. run `adv_review` through the native `adv-review` subagent. never substitute another host's model, runtime, tool, or invocation method.

## worktrees

opencode isolates tasks in git worktrees. use a worktree for implementation, review, and deploy operations unless the user explicitly directs work in the primary checkout. set the worktree parent with `worktree.directory` in global config when the default is not wanted. do not mutate the primary checkout for isolated work.

## mcp

opencode mcp servers live under `mcp.servers` in `~/.config/opencode/opencode.json(c)`. the doctrine sync wires these servers:

- `semble` is local: `type` `local`, `command` `["semble"]`.
- `honcho` is remote at `https://mcp.honcho.dev` with headers `Authorization: Bearer {env:HONCHO_API_KEY}`, `X-Honcho-User-Name: {env:HONCHO_PEER_NAME}`, and `X-Honcho-Workspace-ID: {env:HONCHO_WORKSPACE}`.
- `porch` is remote at `https://porch.sh/mcp` with header `Authorization: Bearer {env:PORCH_MCP_TOKEN}`.

use `{env:...}` references. never write secret values into config. when a required environment variable is absent, omit that server. do not write provider credentials or unrelated servers.

## service mode

the image runs opencode V2 in the foreground. `workstation/entrypoint.sh` sets `hostname 0.0.0.0`, `port "${OPENCODE_SERVER_PORT:-4096}"`, and `password "${OPENCODE_SERVER_PASSWORD:?set OPENCODE_SERVER_PASSWORD}"`, then supervises `opencode serve --service`.

a host runs `scripts/machine-setup.sh`, which uses the background service instead. it reconfigures with `opencode service set hostname 0.0.0.0`, `opencode service set port "${OPENCODE_SERVER_PORT:-4096}"`, and `opencode service set password "${OPENCODE_SERVER_PASSWORD:?set OPENCODE_SERVER_PASSWORD}"`, then `opencode service start`, and waits for an authenticated `/api/info` on `127.0.0.1:$OPENCODE_SERVER_PORT`.

connect to `http://<host>:4096` with username `opencode` and that password.

the server process must receive `HONCHO_API_KEY`, `HONCHO_WORKSPACE`, `HONCHO_PEER_NAME`, `PORCH_MCP_TOKEN`, and, when configured, `CLIPROXY_API_KEY`, so its `{env:...}` mcp headers and provider key resolve.

## cliproxyapi provider

`scripts/wire-opencode-provider.ts` merges `providers.cliproxyapi` into `~/.config/opencode/opencode.json(c)` when `CLIPROXY_BASE_URL` and `CLIPROXY_API_KEY` are both set, and removes it when either is absent. the package is `@opencode/ai/providers/openai-compatible`; `settings.baseURL` is `CLIPROXY_BASE_URL`; `settings.apiKey` is `{env:CLIPROXY_API_KEY}` (never a literal).

## no cross-host mechanics

do not use another harness's config path, agent file, skill directory, model name, runtime label, or invocation method in an opencode session. do not rely on compatibility skill discovery from other harnesses; load the native skills under `~/.config/opencode/skills`.

## external cli agents

if an approved plan requires an external cli agent, start it detached. write its brief and final result to porch (`sessions/<session>/agent-notes-<id>.md` or `agent-findings-<id>.md`). a temp local file is allowed only so the process can exit. save it to porch and delete the temp. redirect raw output to a temp log. do not read that log unless the porch note is missing or incomplete.

## local handoff receipts

on a machine that declares the local handoff override, a delegation carries exactly one pointer line:

```
handoff: {"note":"<abs note path>"}
```

the `handoff` plugin hooks `tool execute.before` and rejects a `subagent` call whose prompt lacks exactly one pointer with a current receipt. the core is `~/.config/opencode/handoff.ts`. it writes authored blocks by default with zero model calls; `--compress` requests native compression. the receipt records the last delta's processing mode. activate the guard with `doctrine-sync install-handoff-local`; ordinary sync deploys the core only, and a porch-only host never receives the guard. receipts are local to this machine.
