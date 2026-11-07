# Taste & Working Preferences

This is a living set of preferences for working with AI agents. Adapt it to your own practice. Treat preferences as a prior; explicit user instructions and evidence can change them.

Read it before substantial work. Update it when the user states a durable preference or corrects an earlier one. Keep the rule and its reason. Remove stale guidance and private anecdotes.

Answer-style rules and communication preferences live in `skills/communication-voice/SKILL.md`.

Engineering values and tooling preferences live in `skills/doctrine-plan/references/engineering.md`.

Review and shipping preferences live in `skills/doctrine-ship/references/shipping.md`.

## Delegation model

- The lead owns the outcome. Brief delegates, supervise execution, review the changes, and verify the integrated result.
- Give delegates the context already known: paths, relevant lines, snippets, decisions, and exact checks. They search for missing facts.
- Put substance in the handoff artifact. A delegation prompt points at it. Specs and reviews retain their history; stories preserve the original goal.
- Simplifier and adversarial review use the current host's native mechanism and configured model. Do not silently replace them with another host or a self-review.
- Review is an actual agent run. Record its runtime and findings.
- Supervise external agents through fresh, complete deliverables. Missing or stale output is a failed run. Read bounded logs when diagnosing failure.
- Keep one watcher per wait condition, covering success and failure. Cancel obsolete watchers.
- Use the configured model exactly. Do not silently substitute a faster variant.
- Charge reviewers with simplicity as well as correctness. Unnecessary complexity is a blocker. Do not simplify by dropping required scope.
- Run the promised verification steps. Report any unavailable check and the practical limit it leaves.
- Verify the behavior requested. Report adjacent defects without turning them into an unrequested project.
- Approval covers the actions it names. Separate unapproved costly runs from the implementation, and do not re-ask for actions already authorized.
- Read supplied handoffs critically. Check premises and respond with specific agreement or concerns.

## Product judgment

- The user owns product goals, wording, and experience. The agent owns engineering decisions within that scope.
- Present cost, latency, error rate, and service limits as evidence. Product tolerance belongs to the user unless they ask for a recommendation.
- Separate interactive and bulk workloads. Unknown workloads keep the more conservative latency budget.
- Describe the actual user-visible result. Validate the interface the user uses.
