---
name: claude-transplant
description: Move the current session's work into a fresh Claude CLI session with Remote Control enabled, so the user can drive it from claude.ai or his phone. Use when he says "transplant your consciousness", "continue this in claude cli", "spawn a claude cli agent with remote control", or "hand this off to a remote-control session". Writes a full handoff brief, launches the CLI detached in tmux, delivers the brief, verifies the successor is working, and returns the session URL.
---

# claude transplant

move live work into a new claude cli session that the user can drive remotely. the successor must start working immediately — a session that sits idle at an empty prompt is a failed transplant.

## the four steps

1. write the handoff brief to porch
2. launch the cli detached in tmux with remote control
3. deliver the brief and confirm the successor started
4. give the user the url and say what the successor holds

## 1. write the handoff brief

save it to porch as `sessions/<session>/story-<slug>.md` via `vault_save` (see the porch section in `CLAUDE.md`). the porch note is the durable record; the prompt you send later only points at that title. use the story format in `~/.claude/HANDOFFS.md`; where-we-are, harness, stop conditions and known blockers go under the story's `## context`. the story is written once; open a spec for the continuation and log progress there.

the successor knows nothing. carry everything you paid to learn — see the story `## context` slots.

write it as one linear pass. `~/.claude/HANDOFFS.md` rules 4, 6 and 7 apply (linear pass, sensitive data and secrets, lowercase ste).

## 2. launch

```bash
tmux kill-session -t <name> 2>/dev/null
tmux new-session -d -s <name> -x 200 -y 50 -c <cwd> \
  "claude --remote-control <name> --model 'claude-opus-5[1m]'"
sleep 30
tmux capture-pane -t <name> -p | grep -v '^\s*$' | tail -25
```

**never pipe the launch command.** `| tee`, `> log`, or any redirect makes stdout a non-tty, the cli switches to `--print` mode, and it dies instantly with `Input must be provided either through stdin or as a prompt argument when using --print`. read the session through `tmux capture-pane`, not a log file.

quote the model id — the brackets in `claude-opus-5[1m]` are shell glob characters.

the banner prints `/remote-control is active · Continue here, on your phone, or at https://claude.ai/code/session_<id>`. that url is the deliverable. if it is absent, the bridge did not start: check `disableRemoteControl` in managed settings before retrying.

## 3. deliver the brief

preferred path — `ListAgents`, then `SendMessage` to the new peer. the row name is the address; append its `[ref]` when the tool asks you to disambiguate.

**verify it actually landed.** capture the pane again. if you see `Held peer message … not delivered to Claude`, the receiver parked it: inbound peer messages are held when the sender's permission-mode class differs from the receiver's. the session looks empty because it never got the message.

fallback — type the brief straight into the session as its first prompt:

```bash
tmux send-keys -t <name> -l '<one-line prompt>'
sleep 1
tmux send-keys -t <name> Enter
```

`-l` sends the text literally. keep it to a single line with no embedded newlines, or each newline submits a partial prompt. send `Enter` as a separate call.

the prompt should match `HANDOFFS.md` `## prompt shape` — porch title, working directory, branch — or, for this transplant-only bootstrap, stay short and point at the porch title:

> you are the continuation of <work>. the user moved the work here so he can drive it from remote control. FIRST load the newest porch note titled `sessions/<session>/story-<slug>.md` (`vault_search` the exact title; if empty, search once more; take the newest `createdAt`) in full — it carries the whole context. THEN read TASTE.md / TENETS.md / LOCAL.md in full. <the task in one or two sentences, with stop conditions>. <the two or three rules that override convenience>. <the one thing to resolve before anything else, and the instruction to stop and ask rather than improvise if it fails>. start now.

the standing fix for the held-message path is `"crossSessionInbound": "accept"` in `~/.claude/settings.json` (see CLAUDE.md, session harness settings). settings load at startup, so sessions already running when it was set still hold. the tmux fallback always works.

## 4. confirm and report

capture the pane once more and check the successor is running tools, not idle. then give the user:

- the session url
- what the successor is doing right now
- what the handoff carries, so he knows what he does not need to re-explain
- any stale notice left in its scrollback (a held message that is now redundant), so it does not read as a fault

## rules

- one transplant per session; do not leave two sessions working the same branch
- the successor inherits the working directory — launch it with `-c <worktree>`, not the primary checkout, when the work lives in a worktree
- never transplant to bypass a permission decision your own session was denied
- tell the successor to stop and ask the user when a premise fails, rather than substitute its own plan
