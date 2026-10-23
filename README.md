<p align="center">
  <img src=".github/assets/banner.png" width="640" alt="agent-doctrine: dithered pixel art of a lead node dispatching to three agents above an open book with a check mark">
</p>

<h1 align="center">agent-doctrine</h1>

<p align="center">
  <strong>A shared operating doctrine that takes coding agents from spec to a tested PR.</strong>
</p>

<p align="center">
  <a href="#whats-in-the-repo"><img src="https://img.shields.io/badge/hosts-7-171914?style=flat-square" alt="hosts: 7"></a>
  <a href="https://bun.sh/"><img src="https://img.shields.io/badge/runtime-bun-171914?style=flat-square" alt="runtime: bun"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/sisig-ai/agent-doctrine?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="#whats-this-for">What's this for?</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#optional-services-honcho-and-porch">Honcho and Porch</a> ·
  <a href="#development">Development</a>
</p>

agent-doctrine is a set of instructions, role prompts, and skills that one sync installs into Claude Code, Codex, Cursor, OpenCode, Grok, Muse, and Amp. Every agent on the machine then follows the same loop: **scout → gate → plan → implement → review → consolidate → verify → ship**.

## What's this for?

> It's easy to ship code with AI, but shipping well-vetted and well-tested code is a whole different beast altogether. This repo is an encapsulation of over a year's worth of base workflows, prompts, and skills that have been continuously refined and iterated on to allow our AI agents to ship tested work confidently. This allows us to write a spec - dispatch to an AI agent - which will then dispatch to its own team - and return with a well-tested PR ready for final human approval.

In practice, the doctrine gives each agent:

- A role. The agent you talk to is the lead. It plans, delegates, reviews, and ships. It does not hand-write the code unless you tell it to.
- A pre-code gate. Before any edit, the lead answers fifteen questions from [TENETS.md](TENETS.md) in the transcript, with evidence: smallest correct change, blast radius, how to prove it on real data, how to verify it.
- A team. `scout` reads the codebase, `implementer` builds each split of the plan, `simplifier` cuts the plan down, and `adv_review` tries to break the diff. [delegation.toml](delegation.toml) binds each role to a model per host.
- Written handoffs. Specs, reviews, and stories are files with a fixed shape ([HANDOFFS.md](HANDOFFS.md)), so any agent on any host can pick up the work.
- Two speeds. **Fast** mode keeps the gate and a diff review per split. **Rigorous** mode adds plan simplification, adversarial plan review, and your approval before code.
- One voice. A shared answer style and a per-prompt style reminder apply to every reply, spec, review, PR body, commit message, and code comment, on every host.

This repo is heavily opinionated. One of its goals is AI-written prose that does not read as AI slop. The answer style in [CLAUDE.md](CLAUDE.md) requires:

- Simplified technical English (ASD-STE100): one meaning per word, one idea per sentence, 8 to 20 words per sentence, active voice.
- The answer first, then the facts, then a stop. No recaps, no closing offers, no praise or apologies.
- A number, file, name, or decision in each claim.
- Literal words. No metaphors or analogies when a plain phrase works, and no stock words such as "robust", "seamless", "leverage", or "delve".
- No em dashes.

The same opinions cover engineering: a written gate before code, the smallest correct change, and proof on real data.

Use it as-is, or fork it and treat it as a starting point. [TASTE.md](TASTE.md) holds the working preferences you will most likely want to rewrite.

## Quick start

Requires Git and [Bun](https://bun.sh/). Installation rewrites global agent instructions (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.cursor/rules/doctrine.mdc`, and others), so back them up first.

**1. Back up your current agent config.**

```bash
tar czf ~/agent-config-backup.tgz -C ~ \
  $(cd ~ && ls -d .claude .codex .cursor .config/opencode .grok .config/muse 2>/dev/null)
```

**2. Install the doctrine.**

```bash
git clone https://github.com/sisig-ai/agent-doctrine.git
cd agent-doctrine
bun install --frozen-lockfile
export CLAUDE_MD_DIR="$PWD"
./sync.sh apply-snapshot
```

`apply-snapshot` installs this checkout into every agent home it finds. It does not pull or push Git.

**3. Write your `LOCAL.md`.** Agents read it at session start. Put machine facts here, and opt out of the services you do not use (see [below](#optional-services-honcho-and-porch)).

```bash
$EDITOR ~/.claude/LOCAL.md
./sync.sh reconcile-local   # symlinks the same file into every other agent home
./sync.sh status
```

**4. Run your first task.** Open your agent in a project and hand it a spec:

```text
add a --json flag to the export command. output must match the existing
csv columns. include tests.
```

The lead asks `fast or rigorous?`, dispatches a scout, answers the tenets gate in the transcript, writes the spec with its splits, starts one implementer per split, reviews each diff, merges, runs the suite, and comes back with a PR for your approval.

**5. Make it yours.** Edit [TASTE.md](TASTE.md) for your preferences and [delegation.toml](delegation.toml) for the models you have access to. Then regenerate and re-apply:

```bash
bun run generate
./sync.sh apply-snapshot
```

For ongoing personal changes, fork this repo and set `CLAUDE_MD_REPO` to your fork. Keep private project memory in a separate private fork.

**Publication boundary:** `sync-*`, reflection apply, and several generator commands can commit and push local changes. Do not point them at the public upstream while importing private preferences or cloud rules. `projects/`, reflection ledgers, local context, and credentials are ignored in this public edition.

### What's in the repo

| File | Purpose |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Shared role, answer style, autonomy, and operating loop (the name is historical; every host uses it) |
| [TENETS.md](TENETS.md) | Four engineering tenets and the fifteen-question pre-code gate |
| [TASTE.md](TASTE.md) | Working preferences to adapt to your own practice |
| [HANDOFFS.md](HANDOFFS.md) | Specs, reviews, stories, and delegation contracts |
| [hosts/](hosts/) | Host-specific mechanics |
| [delegation.toml](delegation.toml) | Model and runtime bindings for each role |
| [skills/](skills/) | One skill per step of the engineering loop |

Adapters cover Claude, Codex, Cursor, OpenCode, Grok, Muse, and Amp. Devin has a manual host guide. Model bindings are editable examples and depend on your provider access.

## Optional services: Honcho and Porch

Two hosted services extend the doctrine across machines. Neither is required, and this repo ships no account or credentials for either.

| Service | What it does | Default | Without it |
| --- | --- | --- | --- |
| [Honcho](https://honcho.dev) | Shared agent memory across machines and tools | Off unless configured | Agents rely on doctrine files and project memory only |
| [Porch](https://porch.sh) | Shared store for specs, reviews, stories, and research notes between agents | Default handoff store | Handoffs are local files on this machine |
| [tokensieve](https://github.com/sisig-ai/tokensieve) | Compresses noisy command output before it reaches the agent | Used when on `PATH` | Agents run the raw command |
| [semble](https://github.com/MinishLab/semble) | Local code search MCP | Installed by full setup | Agents use built-in grep and file reads |

### Opt out with `LOCAL.md`

`~/.claude/LOCAL.md` is per-machine, never committed, and read by every agent at session start. Declare what this machine does not use:

```markdown
# local services

- this machine does not require porch. store handoffs as local files.
- this machine does not use honcho. skip memory recall and memory saves.
```

Then apply it:

```bash
./sync.sh reconcile-local
./sync.sh install-handoff-local    # only if you use OpenCode: installs the local handoff guard
./sync.sh handoff-capabilities     # reports local handoff support per host
```

What each line changes:

- `does not require porch` is a marker the tooling checks. With it, handoffs become local files, and each delegation carries one pointer line, `handoff: {"note":"<abs path>"}`. `install-handoff-local` refuses to run without the marker. See rule 11 in [HANDOFFS.md](HANDOFFS.md).
- `does not use honcho` is an instruction to the agent. The doctrine already treats Honcho as optional; this line stops agents from calling memory tools or reporting Honcho as down. Also leave `HONCHO_API_KEY` and `HONCHO_WORKSPACE` unset, so the MCP wiring skips Honcho.

To turn a service back on, delete its line, export its variables from [SETUP.md](SETUP.md), and run `python3 scripts/wire-mcp.py`.

The full bootstrap (`scripts/machine-setup.sh`) currently requires the Honcho and Porch variables. The doctrine-only quick start above does not.

## Optional full workstation

Two paths go past the doctrine-only install. Both need your own accounts, and both read secrets from the environment or from mounted files, never from this repo.

### Bare machine: `scripts/machine-setup.sh`

Run it on a Mac or Linux machine you already use. [SETUP.md](SETUP.md) lists the variables it requires. In order, it:

1. Installs Bun, uv, semble, and the `claude`, `codex`, `cursor-agent`, and OpenCode V2 CLIs when they are missing.
2. Runs `./sync.sh install` (wrappers such as `doctrine-sync` and the `LOCAL.md` reconcile) and `./sync.sh pull-all` (doctrine into every agent home).
3. Wires the Honcho, semble, and Porch MCP servers into Claude, Cursor, Codex, and OpenCode configs. Secrets go in as `{env:...}` references, never as values.
4. Starts OpenCode as a service on port 4096 behind `OPENCODE_SERVER_PASSWORD`, and waits up to 60 s for it to answer.
5. Runs `scripts/mcp-smoke.sh` and `./sync.sh status`. CLI logins stay manual (see [SETUP.md](SETUP.md)).

### Container: `workstation/`

A Docker image for a remote or throwaway agent box, reached over Tailscale SSH as user `coder`. [workstation/README.md](workstation/README.md) has the full runbook.

- The image pins Claude Code, Codex, OpenCode, T3 Code, Bun, uv, semble, Docker-in-Docker, and Tailscale, and builds tokensieve from source.
- On start, `entrypoint.sh` joins the tailnet, imports CLI logins from `secrets/` once, runs `sync.sh apply-snapshot`, wires OpenCode, and supervises OpenCode (port 4096) and T3 Code (port 3773).
- Named volumes keep `/home/coder`, Docker state, and the Tailscale identity across rebuilds.
- `workstation/portable-LOCAL.md` is the `LOCAL.md` template for the container.
- The OpenCode `/setup-new-machine <ssh instructions>` command provisions this container on a remote Docker host.
- The image needs `privileged: true` for Docker-in-Docker. Anyone who controls the container controls its nested Docker daemon.

### Scripts

| Script | What it does |
| --- | --- |
| `sync.sh` | Entry point for every `doctrine-sync` command. Finds Bun, then runs `src/cli.ts`. |
| `scripts/machine-setup.sh` | Full bootstrap of a bare machine (above). |
| `scripts/wire-mcp.py` | Writes Honcho, semble, and Porch entries into `~/.claude/settings.json`, `~/.cursor/mcp.json`, and `~/.codex/config.toml`, and writes `~/.config/porch/mcp.env` (mode 600). Skips Honcho or Porch when its variables are unset. |
| `scripts/wire-opencode-mcp.ts` | Merges the same servers into OpenCode's `opencode.json(c)`. Keeps comments and other settings. Fails without writing on invalid JSONC. |
| `scripts/wire-opencode-provider.ts` | Adds the optional `cliproxyapi` OpenCode provider when `CLIPROXY_BASE_URL` and `CLIPROXY_API_KEY` are both set, and removes it otherwise. |
| `scripts/mcp-smoke.sh` | Checks semble on `PATH`, a live Honcho list call, a live Porch `tools/list`, the `mcp.env` file mode, and each host's MCP config. Runs every check, then exits non-zero if any failed. |
| `scripts/handoff.ts` | Writes local handoff notes (specs, reviews, stories) for machines in local handoff mode. Each write appends a delta, keeps history byte-exact, holds a per-note lock, and records a receipt with a content hash. `--compress` shortens prose blocks through the agent's own CLI. |
| `scripts/generate.ts` | `bun run generate`: rebuilds host adapters and test fixtures in the repo without touching agent homes. |
| `scripts/check-public.ts` | `bun run check:public`: fails on tracked private paths (`projects/`, `LOCAL.md`, `.env`, ledgers), credential patterns, Tailscale hostnames, and unreviewed binaries. CI runs it. |

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

Agents save small notes as they work (Claude's `~/.claude/memory`, Codex's `~/.codex/memories`, Cursor's cloud User Rules). Reflection reads those notes and proposes edits to the shared `CLAUDE.md` and `TASTE.md`, so a correction made once on one host becomes doctrine on every host.

Inputs per host:

- Claude: every file in `~/.claude/memory`, plus `feedback_*.md` files in each project's memory. Other project memory is ignored.
- Codex: selected `~/.codex/memories/*.md`.
- Cursor: cloud User Rules, exported through the MCP bridge into `~/.cursor/memory/`.

Each run has two steps:

1. `reflect-<host>-memory-preview` sends the pending notes and the current docs to `claude -p` with no tools and a fixed JSON schema. The output is a patch (`.memory-reflect.patch`), a rationale, and one status per note: `applied`, `already_represented`, or `not_relevant`. The patch must pass `git apply --check`, and every pending note must get exactly one status, or the run fails.
2. `reflect-<host>-memory` applies the patch, appends the statuses to the ledger, re-syncs the host, and commits and pushes. Point it at your own fork, not this upstream.

Raw memory files never enter the repo. Only the reviewed doctrine edits do.

### Ledgers and state files

A ledger is an append-only JSONL file. Each line records one decision with a timestamp, host, path, and sha256. Ledgers make the tooling repeatable: a memory note whose path and hash already have a closed status is skipped on the next run, and a changed note is analyzed again.

| File | Written by | Records |
| --- | --- | --- |
| `memory-reflect-ledger.jsonl` (also `codex-` and `cursor-` variants) | memory reflection | One line per memory note: status, rationale, and the sha256 of the patch that applied it |
| `agent-reflect-ledger.jsonl`, `cursor-*-reflect-ledger.jsonl`, `opencode-*-reflect-ledger.jsonl`, `codex-agents-md-reflect-ledger.jsonl` | the generators | Each write or delete of a generated host adapter |
| `.*-reflect.patch`, `.rationale`, `.statuses.json` | preview commands | The last preview, consumed by the matching apply |
| `~/.local/state/doctrine-sync/project-memory/<id>.ledger.json` | project memory | The merge base: the hash of every memory file at the last sync |
| `~/.config/doctrine-sync/projects.toml` | `project-memory-register` | Which checkout and native memory directory map to each project id |

All repo-root ledgers and preview files are gitignored in this edition, and `check:public` fails if a ledger is tracked. A private fork can commit its ledgers to share the history across machines.

## Project Memory

Project memory keeps one shared copy of an agent's per-project notes (for example Claude's `~/.claude/projects/<project>/memory`) in your private fork under `projects/<id>/memory`, so every machine sees the same notes.

The sync is a three-way merge. The base is the ledger in `~/.local/state/doctrine-sync/project-memory/`. The two sides are the repo copy and the agent's native directory. A file changed on one side only takes that side. A file changed on both sides is a conflict:

- `MEMORY.md` index conflicts merge without a model, keyed by link target. Two edits to the same entry fail.
- Other notes go to Claude in `--safe-mode` with no tools, no MCP servers, and no saved session. The tool checks the returned merge plan against a schema and caches verified merges.

`project-memory-preview` writes the result and an approval hash. `project-memory-apply --approval-hash <hash>` writes those exact bytes, updates the ledger, and commits and pushes `projects/<id>/memory`. It never runs a model again. `project-memory-pull` copies the repo version to a machine and refuses when the native copy has diverged. Every step holds a per-project file lock.

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
