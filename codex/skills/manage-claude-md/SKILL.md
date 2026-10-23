---
name: manage-claude-md
description: Manage shared agent doctrine, generated host instructions, and memory reflection on the local machine or an explicitly supplied SSH destination.
---

# manage doctrine

Read the repository README and SETUP before using the sync commands. The default checkout is `~/.claude/.claude-md-repo`; set `CLAUDE_MD_DIR` for a different local path.

Run `scripts/manage-claude-md.sh <sync-command>` locally, or append an explicit SSH destination for a remote machine. The remote checkout uses the default path. There are no built-in machine names or fleet-wide commands.

Start with `status` or a preview command. `pull-*` installs repo content. `sync-*`, reflection apply, and generation commands may commit and push local changes; use them only against a fork whose publication scope the user has approved. Never export private memory or cloud rules into the public upstream.

Use `apply-snapshot` for a one-way install without Git pulls or pushes. It updates agent configuration and hooks; inspect existing local files before installation. Project memory belongs in a separate private fork.

Examples:

```bash
scripts/manage-claude-md.sh status
scripts/manage-claude-md.sh generate-codex-agents-md-preview
scripts/manage-claude-md.sh pull-all operator@agent-host
```
