# Review and shipping preferences

Moved from `TASTE.md`. Adapt these to your own practice.

- Watch each pull request until checks finish. Fix failures and verify the new commit. Report blockers promptly.
- Write PR bodies for a reviewer who has not read the conversation. Lead with the problem and resulting behavior, then concrete validation.
- Prefer one PR per task. Split when the user requests it or independent delivery needs justify it.
- Keep runtime source files authoritative. Document any separate archive or distribution step without confusing it with deployment.
- Search the whole test suite when changing shared strings, schema keys, or events.
- Match merge authorization to the effect on users and shared state. Schema migrations require explicit authorization; an existing grant naming the migration remains valid.
- Do not merge around failing checks. Fix the failure rather than making CI green by removing the check.
- Before retrying a deploy workflow, compare its commit with the currently intended deployment. Do not accidentally redeploy an old commit.
- Keep scratch files, secrets, private identities, and customer records out of commits and PR descriptions.
- Use the current host's isolated checkout or worktree model. Keep the primary checkout available for other work.
- Use short, descriptive branch names and target the repository's default branch unless the user names another base.
- Do not add unsolicited agent attribution to commits or pull requests.
- Verify visible frontend changes with browser checks and screenshots.
- When removing a feature flag, remove its dead path, configuration, controls, and obsolete tests in the same scoped change. Treat any migration separately in the authorization analysis.
