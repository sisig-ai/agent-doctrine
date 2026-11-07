---
name: development-loop
description: >-
  load before any change that edits, creates, or deletes code, config, or
  tests: the eight-step engineering loop (session start, scout, tenets gate,
  plan with splits, implement, diff review, consolidate, verify and ship), the
  two session modes, and the stage skill to load for each step.
---

# Engineering work sequence (mandatory for any code change)

Any change that edits, creates, or deletes code, config, or tests follows this order, **no size-based shortcuts**, including staff-only UI, internal tools, cloud/background agents, and "obvious" one-file fixes. The session runs in one of two modes. Ask the user `fast or rigorous?` at session start and assume **fast** when the user does not say. The mode covers the plan-level reviews and approval only. every step below is mandatory in both modes:

1. **Session start**: full reads of `TASTE.md` / `TENETS.md` / `LOCAL.md`.
2. **Scout**: the lead writes a scout brief and dispatches `scout` as a subagent first; the lead reads the findings before the gate. Load `doctrine-scout`.
3. **Tenets gate**: answer all fifteen questions **in the transcript**, with evidence. Mental clearance is invalid. Required in both modes. Load `doctrine-plan`. The questions are in `../doctrine-plan/references/tenets-gate.md`.
4. **Plan loop with splits**: write the spec to porch (`sessions/<session>/spec-<slug>.md`, format in `agent-handoffs`) with its `## splits`, then run the fast or rigorous plan loop for the session mode. Load `doctrine-plan`.
5. **Implement splits** via the implementation role, one per split, all started in the same turn (hand-write only when the user explicitly directs). Load `doctrine-implement`.
6. **Diff review** via `adv_review`, one per split, in both modes; blockers fixed by that split's implementation role (one author converges the diff). Load `doctrine-review`.
7. **Consolidate**: the lead merges the split branches, runs the full test suite, and routes any post-merge edit to an implementer. Load `doctrine-consolidate`.
8. **Verify** end-to-end yourself, then commit / PR / ship. Load `doctrine-ship`.

Load the skill for a step before you start the step. A host with no skill tool reads `skills/<name>/SKILL.md` from the path in its host overlay, in full.

The spec is the handoff record in both modes; its status line reads `status: fast by lead <date>` or `status: approved by the user <date>`.

If you are about to call a write/edit tool and steps 1 to 4 are not already satisfied in this conversation, stop. Cloud and background agents have no special exemption.

## modes

- **fast:** the spec goes straight to the implementation role. The written gate, the diff review per split, and verification all stay.
- **rigorous:** adds `simplifier`, plan-level `adv_review`, and the user's approval of the spec before any code.

## handoffs

Load `agent-handoffs` before you give or receive any agent-to-agent work. It holds the porch rules, the three note formats, and the fixed prompt wording.
