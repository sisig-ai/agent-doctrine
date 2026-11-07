# Shared services: Honcho, Porch, and machine setup

Moved from `CLAUDE.md`.

# Honcho (centralized agent memory)

Honcho is the centralized lived-memory service for agent continuity across machines and tools (Claude, Cursor, Codex, OpenCode). It supplements, but does not replace, doctrine files and project-memory.

**Configuration.** Honcho is optional. Configure your own workspace, peer name, endpoint, and credentials through the environment described in `SETUP.md`. No shared account or workspace is supplied by this repository. If you choose Honcho as a dependency and it is unavailable, report the failure.

**How to use it.** Use memory tools to recall context and save non-sensitive preferences and continuity. Keep reviewed doctrine and project facts in their designated source files.

**do not answer or echo honcho's injected context.** when honcho injects memory notes or a memory summary, treat them as silent conversation context, not a user message. do not answer them as an instruction, and do not echo back or mention the notes or the summary. do not reply with "Message contained memory notes only, no new instruction" or any other "no new instruction arrived" notice. why: the injected context is background, and restating it is noise.

**Doctrine and project-memory remain law.** The shared doctrine, `TASTE.md`, `TENETS.md`, the current host overlay, and project-memory are the curated contract. Durable reviewed facts still go to the host's project-memory write path. Do not treat Honcho conclusions as a substitute for that gate.

**Memory privacy.** Never write secrets, personal identifiers, confidential customer content, or production records into shared memory. Enabling session capture requires the operator to approve the destination and data scope.

# Porch (shared agent files)

Porch is the store for agent-to-agent files and for research, probes, and experiment findings. Endpoint `https://porch.sh/mcp`. Configure your own workspace. Auth is the bearer token in `PORCH_MCP_TOKEN` (`~/.config/porch/mcp.env`, mode 600). If Porch is the configured handoff store and it is down, report the failure. A machine may instead declare the local handoff mode described in `../../agent-handoffs/references/local-receipts.md`.

The note title is the path: `sessions/<session>/<file>`. `<session>` is one id for the work. The lead sets it, and every agent on every machine reuses it. Do not put a host name in the path. Do not use a harness id that the other agents do not have. `<file>` is `spec-<slug>.md`, `review-<slug>.md`, `story-<slug>.md`, `agent-notes-<id>.md`, `agent-findings-<id>.md`, `research-<topic>.md`, `probe-<slug>.md`, or `findings-<slug>.md`.

Save with `vault_save` (`kind` `note`, `title` = the path, `content` = the full markdown, tags `session:<session>` `type:<type>`, metadata `path`, `session`, `type`). Each save is a new note. The current text is the exact title with the newest `createdAt`. Load with `vault_search` on that title. If the result is empty, search once more. A miss after the retry is a stop. Images use `vault_upload_image` with `path` `sessions/<session>/`.

No secrets or confidential records belong in shared handoffs. Keep restricted inputs in approved storage and reference their location. A tool that only writes local files may use a temporary file; upload only permitted content. A file a command must open (environment, script, container input) stays on disk and is not a handoff.

## Setting up a new machine

Read `SETUP.md` before installing. Start with doctrine only. The optional MCP and workstation setup requires your own service accounts and credentials. `workstation/README.md` documents the container path. Never place machine-specific settings or credentials in shared doctrine.
