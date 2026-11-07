# Engineering values and tooling

Moved from `TASTE.md`. Adapt these to your own practice.

## Engineering values

- Every code change follows scout, written gate, plan with splits, implementation, review per split, consolidation, verification, and shipping. Rigorous mode adds plan simplification, adversarial plan review, and user approval. Fast mode keeps the gate and diff review.
- Keep touched source files at or below 500 nonblank, noncomment lines. Include required splits in the plan.
- Measure before claiming. Capture baselines, inspect outputs, and distinguish warm and cold cache behavior.
- Prove a pipeline fix through its actual output artifact. A passing helper test can miss another guard or an unchanged downstream stage.
- Separate deterministic defects from model compliance. Fix deterministic defects fully; report replay hit rates and residual stochastic misses so the user can decide whether to ship.
- Failures halt the affected operation. Do not hide errors behind fallback behavior.
- Avoid unrequested environment-variable feature gates. Name the rollback path. Bring a necessary staged rollout to the user as an explicit tradeoff.
- Fix flaky tests at their source. A rerun can diagnose a problem; it cannot resolve a race or shared-state defect.
- Cut speculative abstractions, repeated prose, and comments that restate code. Keep complexity required by the requested scope.
- Measure cost, cache hit rate, and latency. Optimize from evidence.
- Skip an expensive check only when its runtime inputs cannot change, with that reasoning stated.
- Carry authorized work to completion: verify, prepare the change for review, publish or deploy when authorized, then report the result.

## Tooling preferences

- Use model services only within the user's approved data scope. Public doctrine does not authorize private-data export.
- Keep credentials in approved secret stores or private files. When a credential helper is designated execute-only, run it without reading it. Never print the returned secret.
- Prefer Bun for new tooling where it fits the existing project. Follow the project's runtime and language boundaries.
- Use semantic code search for behavior and architecture when configured; exact search for strings, callers, and test assertions.
- Use tokensieve for supported noisy commands when installed. Keep full output available for debugging. Do not install permission-bypassing hooks.
- Save research and experiment findings in the chosen handoff store with inputs, measurements, sources, and conclusions. Keep restricted data in approved storage.
- Put nontrivial operational commands in reviewable scripts.
- Use a provider that supports the required output contract. Do not rely on a model ignoring an unsupported schema.
- Turn repeated workflows into skills when the repetition justifies one.
- Follow the repository's container and runtime setup. Keep machine-specific instructions in private `LOCAL.md`.
