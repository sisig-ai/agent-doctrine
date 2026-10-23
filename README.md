# agent-doctrine

A personal operating doctrine for working with AI agents, published by [sisig-ai](https://github.com/sisig-ai).

Make the smallest correct change. Bound its effects. Prove the result on representative data. Explain every regression. Keep the user informed and carry authorized work through to completion.

The operating loop is **scout → gate → plan → implement → review → consolidate → verify → ship**. Fast mode keeps the written gate and diff review. Rigorous mode adds simplification, adversarial plan review, and human approval.

## Start with the doctrine

| File | Purpose |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Shared role, communication style, autonomy, and operating loop |
| [TENETS.md](TENETS.md) | Four engineering tenets and the fifteen-question pre-code gate |
| [TASTE.md](TASTE.md) | Working preferences to adapt to your own practice |
| [HANDOFFS.md](HANDOFFS.md) | Specs, reviews, stories, and delegation contracts |
| [hosts/](hosts/) | Host-specific mechanics |
| [delegation.toml](delegation.toml) | Model and runtime bindings for each role |
| [skills/](skills/) | Repeatable steps in the engineering loop |

The filename `CLAUDE.md` is historical; its policy is shared across hosts. Adapters cover Claude, Codex, Cursor, OpenCode, Grok, Muse, and Amp. Devin has a manual host guide. Model bindings are editable examples and depend on your provider access.

This is an opinionated starting point. Read it, copy the parts you want, and customize the style, tools, approval boundaries, and models. Host overlays expect specific capabilities; installation does not create provider accounts or grant access to them. Porch is the default shared handoff store; a declared local mode is also supported. Honcho is optional memory. No service account or credentials are included.

## Install doctrine only

Requires Git and Bun. Existing agent instructions and hooks can be changed by installation, so review and back up your local configuration first.

```bash
git clone https://github.com/sisig-ai/agent-doctrine.git
cd agent-doctrine
bun install --frozen-lockfile
export CLAUDE_MD_DIR="$PWD"
./sync.sh apply-snapshot
```

`apply-snapshot` installs this checkout without Git pulls or pushes. Legacy `CLAUDE_MD_*` variables and `*-md-sync` names remain supported. For ongoing personal changes, use your own fork and set `CLAUDE_MD_REPO` to its URL. Keep private project memory in a separate private fork.

**Publication boundary:** `sync-*`, reflection apply, and several generator commands can commit and push local changes. Do not point them at the public upstream while importing private preferences or cloud rules. `projects/`, reflection ledgers, local context, and credentials are ignored in this public edition. The project-memory publication workflow is intended for a private fork with its own deliberate tracking policy.

## Optional full workstation

[SETUP.md](SETUP.md) describes CLI and MCP bootstrap. [workstation/README.md](workstation/README.md) describes a locally built container. Both require your own accounts and explicit configuration. The OpenCode service password has no default, and the optional proxy provider stays disabled until you supply its URL and key. Container image publication is a manually triggered workflow.

## Development

```bash
bun install --frozen-lockfile
bun run generate
bun test
bun run check:public
```

`generate` refreshes tracked host adapters and text fixtures locally, without installing into agent homes or pushing. Tests use temporary configurations. The workstation entrypoint test needs Docker; the suite reports it as skipped when Docker is unavailable. Full image builds and live service authentication are separate integration checks.

## License

[MIT](LICENSE). Vendored humanizer skill text retains its own MIT license and attribution; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Style reminder

Each host gets `style-reminder.md` in its context on the schedule below. The sync installs the mechanism; the reminder text is one shared file.

| host | when the reminder is added | limit |
| --- | --- | --- |
| claude | each user prompt | none |
| codex | each user prompt | needs a one-time `/hooks` trust per machine |
| amp | each user turn on local installs | hosted global publication is not done by this sync |
| cursor | session start, and after each successful or failed tool call | tool-free follow-up turns and cloud agents get none |

## Commands

```bash
./sync.sh status
./sync.sh pull-claude
./sync.sh sync-claude
./sync.sh pull-codex
./sync.sh sync-codex
./sync.sh pull-cursor
./sync.sh sync-cursor
./sync.sh pull-opencode
./sync.sh sync-opencode
./sync.sh pull-grok
./sync.sh push-grok
./sync.sh sync-grok
./sync.sh pull-muse
./sync.sh push-muse
./sync.sh sync-muse
./sync.sh pull-all
./sync.sh sync-all
./sync.sh reflect-claude-memory
./sync.sh reflect-codex-memory
./sync.sh reflect-cursor-memory
./sync.sh export-cursor-personal-rules
./sync.sh apply-cursor-personal-rules
./sync.sh sync-cursor-personal-rules
./sync.sh generate-codex-agents-preview
./sync.sh generate-codex-agents
./sync.sh generate-codex-agents-md-preview
./sync.sh generate-codex-agents-md
./sync.sh generate-cursor-rules-preview
./sync.sh generate-cursor-rules
./sync.sh generate-cursor-agents-preview
./sync.sh generate-cursor-agents
./sync.sh generate-opencode-agents-preview
./sync.sh generate-opencode-agents
./sync.sh generate-opencode-agents-md-preview
./sync.sh generate-opencode-agents-md
./sync.sh generate-delegation
./sync.sh project-memory-register <id> <checkout> <claude-native-memory>
./sync.sh project-memory-register home <home-root> <native-memory> --shared-root
./sync.sh project-memory-status <id>
./sync.sh project-memory-preview <id> --claude-bin /path/to/claude --model <full-versioned-model-id> [--delete <relative-path>]
./sync.sh project-memory-apply <id> --approval-hash <hash>
./sync.sh project-memory-pull <id>
./sync.sh reconcile-local
./sync.sh install
```

Backward-compatible aliases still work:

```bash
./sync.sh pull
./sync.sh sync
./sync.sh status
```

Installed wrappers:

```bash
claude-md-sync
codex-md-sync
cursor-md-sync
opencode-md-sync
doctrine-sync
```

## Local-only Blocks

`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, and `~/.cursor/rules/doctrine.mdc` may carry a machine-local block at the top:

```html
<!-- LOCAL-ONLY:BEGIN — machine-specific; stripped before sync, never pushed. -->
# Hard rule: ...
<!-- LOCAL-ONLY:END -->
```

The block is preserved locally and stripped before pushing shared bodies back to the repo.

## Machine-local LOCAL.md

`LOCAL.md` is per-machine guidance (SSH hosts, tool quirks, infra notes). It is **not** committed and does **not** cross machines.

On each host, every agent home must see the same file:

| Path | Role |
| --- | --- |
| `~/.claude/LOCAL.md` | Canonical real file |
| `~/.codex/LOCAL.md` | Symlink → Claude |
| `~/.cursor/LOCAL.md` | Symlink → Claude |
| `~/.config/opencode/LOCAL.md` | Symlink → Claude |
| `~/.grok/LOCAL.md` | Symlink → Claude |
| `~/.config/muse/LOCAL.md` | Symlink → Claude |
| `~/.claude/.claude-md-repo/.local/LOCAL.md` | Gitignored durable cache |

`pull-*` / `sync-*` / `install` / `reconcile-local` all run `reconcileMachineLocal()`. Any present copy may seed the others when contents match; divergent agent homes are merged by claude opus 5 (claude cli, `--safe-mode`) with each input kept under `.local/conflicts/`; a stale repo cache never blocks a sync. `./sync.sh status` reports the link/hash state.

```bash
./sync.sh reconcile-local
./sync.sh status
```

## What Syncs

Claude target:

- `~/.claude/CLAUDE.md` (generated from `CLAUDE.md`, `hosts/claude.md`, and `delegation.toml`)
- `~/.claude/TASTE.md`
- `~/.claude/TENETS.md`
- `~/.claude/HANDOFFS.md`
- `~/.claude/agents/*.md`
- `~/.claude/skills/<skill-name>/` (from `claude/skills/`; copy is additive, so machine-local skills survive)
- `~/.claude/agents/<role>.md` (from `claude/agents/`: `implementer`, `implementer-light`; copy is additive)

Codex target:

- `~/.codex/AGENTS.md` (generated from `CLAUDE.md`, `hosts/codex.md`, and `delegation.toml`)
- `~/.codex/TASTE.md`
- `~/.codex/TENETS.md`
- `~/.codex/HANDOFFS.md`
- `~/.codex/agents/*.md`
- `~/.codex/skills/manage-claude-md`
- generated Codex-native agent skills in `~/.codex/skills/<agent-name>/`

Note: `~/.codex/CLAUDE.md` is no longer synced; it is deleted on pull/sync if present.

Cursor target:

- `~/.cursor/rules/doctrine.mdc` (generated from `CLAUDE.md`, `hosts/cursor.md`, and `delegation.toml`)
- `~/.cursor/TASTE.md`
- `~/.cursor/TENETS.md`
- `~/.cursor/HANDOFFS.md`
- `~/.cursor/agents/*.md` (generated from shared `agents/*.md`)
- `~/.cursor/skills/<agent-name>/` and `~/.cursor/skills/manage-claude-md/`
- cloud User Rules via `manage_personal_rules` MCP ↔ `cursor/personal-rules/manifest.json`

Never sync into `~/.cursor/skills-cursor/` (Cursor-managed builtins).

Machine-local Cursor auth/config/plugin/cache/project state is not synced.

OpenCode target:

- `~/.config/opencode/AGENTS.md` (generated from `CLAUDE.md`, `hosts/opencode.md`, and `delegation.toml`; preserves a local-only block)
- `~/.config/opencode/TASTE.md`
- `~/.config/opencode/TENETS.md`
- `~/.config/opencode/HANDOFFS.md`
- `~/.config/opencode/agents/*.md` (generated native subagents; copied additively so machine-local agents survive)
- `~/.config/opencode/skills/<id>/` (native `humanizer`, `manage-claude-md`, and `setup-new-machine`; copied additively). a stale `adv-review` dir there is removed on pull, sync, and apply-snapshot
- `~/.config/opencode/commands/setup-new-machine.md` (native `/setup-new-machine <ssh instructions>`; provisions a new portable workstation on a remote docker host, see [workstation/README.md](./workstation/README.md); copied additively)

OpenCode MCP is merged separately into `~/.config/opencode/opencode.json(c)` under `mcp.servers` by `scripts/wire-opencode-mcp.ts`. The sync never copies OpenCode config back to the repo. OpenCode has no memory reflection.

Grok target:

- `~/.grok/rules/doctrine.md` (generated from `CLAUDE.md`, `hosts/grok.md`, and `delegation.toml`)
- `~/.grok/TASTE.md`
- `~/.grok/TENETS.md`
- `~/.grok/HANDOFFS.md`
- `~/.grok/agents/{scout,simplifier,adv-review,implementer}.md` (generated from `delegation.toml`; copied additively so a machine-local agent stays)
- `~/.grok/config.toml` compat flags only: `compat.claude.agents`, `compat.claude.rules`, `compat.cursor.agents`, and `compat.cursor.rules` set false. The rest of the file stays, including `[[marketplace.sources]]`.

`pull-grok`, `push-grok`, and `sync-grok` run that target. `pull-all` and `sync-all` call them. `push-grok` rejects a hand edit of `~/.grok/rules/doctrine.md`. Grok skills are not copied back.

Muse target:

- `~/.config/muse/AGENTS.md` (generated from `CLAUDE.md`, `hosts/muse.md`, and `delegation.toml`)
- `~/.config/muse/TASTE.md`
- `~/.config/muse/TENETS.md`
- `~/.config/muse/HANDOFFS.md`

`pull-muse`, `push-muse`, and `sync-muse` run that target. `pull-all` and `sync-all` call them. `push-muse` rejects a hand edit of `~/.config/muse/AGENTS.md`.

Do not edit generated host doctrine by hand. Edit the neutral source, the matching host overlay, or `delegation.toml`, then run the matching generator or sync command. `push-claude` fails if the generated `~/.claude/CLAUDE.md` body differs from its source.

## Agent Generation

Shared agents are canonical in `agents/*.md` using Claude's agent frontmatter. `agents/scout.md` is the one scout persona; it reaches the claude and codex agents dirs, the codex and cursor generated agents and skills, and the opencode and grok agents. Its model comes from `delegation.toml` (`default` means the host picks its default model).

Shared loop skills (`doctrine-scout`, `doctrine-plan`, `doctrine-implement`, `doctrine-review`, `doctrine-consolidate`, `doctrine-ship`) live in `skills/<name>/` and are copied to the `skills/` dir of every host target on pull, sync, and apply-snapshot.

- Codex-native skills generate into `codex/skills/<agent-name>/SKILL.md`
- Cursor agents generate into `cursor/agents/<agent-name>.md`
- Cursor skills generate into `cursor/skills/<agent-name>/SKILL.md`
- OpenCode native subagents generate into `opencode/agents/<agent-name>.md` from shared `agents/*.md` and the role prompts in `opencode/agents-src/`
- Role agents (`scout`, `simplifier`, `adv-review`, `implementer`) take their model from `delegation.toml` (a model of `default` writes no `model:` line); other subagents inherit the session model. Regenerating after a binding change is all that is needed — never edit `opencode/agents/*.md` by hand.
- OpenCode-native doctrine generates into `opencode/AGENTS.md`
- Grok agents generate into `grok/agents/scout.md`, `grok/agents/simplifier.md`, `grok/agents/adv-review.md`, and `grok/agents/implementer.md`. The model comes from `delegation.toml`. Grok doctrine generates into `grok/rules/doctrine.md`. Do not edit those files by hand.
- Muse doctrine generates into `muse/AGENTS.md`. The four role models come from `delegation.toml`. Do not edit that file by hand.

```bash
./sync.sh generate-codex-agents-preview
./sync.sh generate-codex-agents
./sync.sh generate-codex-agents-md-preview
./sync.sh generate-codex-agents-md
./sync.sh generate-cursor-rules-preview
./sync.sh generate-cursor-rules
./sync.sh generate-cursor-agents-preview
./sync.sh generate-cursor-agents
./sync.sh generate-opencode-agents-preview
./sync.sh generate-opencode-agents
./sync.sh generate-opencode-agents-md-preview
./sync.sh generate-opencode-agents-md
./sync.sh generate-delegation
```

`sync-all` runs all generators automatically after syncing shared files.

## Memory Reflection

Claude reflection analyzes global `~/.claude/memory` plus project `feedback_*.md` memories. Codex reflection analyzes selected `~/.codex/memories/*.md`. Cursor reflection exports cloud User Rules through the MCP bridge into `~/.cursor/memory/` and then distills durable guidance into shared `CLAUDE.md` / `TASTE.md`.

Raw memories are not synced. Durable doctrine can be published; reflection ledgers stay local in this edition.

## Project Memory

Registered project memory is an opt-in, canonical corpus under `projects/<id>/memory`.
Machine registrations and base ledgers remain local. Every Markdown file in the registered
native directory is included automatically in a hash-bound preview.
Conflict previews use authenticated Claude.ai OAuth in isolated safe mode for ordinary notes;
`MEMORY.md` when it is a recognized `# Memory Index` merges deterministically (keyed by link
target, fail-loud on same-key concurrent edits) and never invokes Claude. API keys and provider
overrides are rejected. Apply writes the approved bytes and never reruns a model; `sync-all` never pushes project
memory implicitly. `doctrine-sync project-memory path` is the shared Codex/Cursor router contract
and returns an absolute canonical `memory/` directory. Agents must not load `MEMORY.md` in full —
use a bounded `rg -i -m 10` against the index, then read only linked notes. `project-memory-pull` refuses native
divergence and requires a preview instead.
`--shared-root` registers a non-git directory under the manifest identity `shared:<id>` and routes
only that exact directory; descendants do not inherit it. The shared identity is stored in the
project manifest and is not a separate project namespace.

Pass `--json` to get the full agent contract as structured output:

```bash
doctrine-sync project-memory path --json [/path/to/checkout]
# → {"project_id":"…","canonical_memory":"/abs/…/projects/<id>/memory","native_memory":"/abs/…"}
```

**Write contract:** to persist new knowledge, create `agent_note_<slug>.md` under the **native_memory** path. Never edit existing corpus files unless merging. Native writes are local until `project-memory-preview` + `project-memory-apply`; pull with `project-memory-pull` on other machines. Never write `feedback_*.md` (Claude reflection inputs).

## Cursor Personal Preferences

Cursor-cli reads global file rules from `~/.cursor/rules/*.mdc`. Cloud User Rules (Settings → Rules) are optional and only available through `manage_personal_rules` MCP in the Cursor IDE — not in cursor-cli today.

Repo transport uses `cursor/personal-rules/manifest.json`. On every apply/sync:

1. **cursor-cli (always):** manifest → `~/.cursor/rules/doctrine-synced/*.mdc` with `alwaysApply: true`
2. **IDE cloud (when MCP available):** manifest ↔ `manage_personal_rules` reconcile

```bash
./sync.sh export-cursor-personal-rules   # mcp/cli/sqlite -> repo + cli files
./sync.sh apply-cursor-personal-rules    # repo -> cli files (+ mcp when available)
./sync.sh sync-cursor-personal-rules     # bidirectional reconcile
```

Set `CURSOR_AGENT_WORKSPACE` if the MCP bridge should run `agent` from a specific project directory.
