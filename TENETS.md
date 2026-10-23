# Tenets

The operating doctrine for engineering work. Every change clears this bar before it ships. When a tenet collides with convenience, the tenet wins.

**Primus inter pares: simplicity.** When two tenets seem to conflict, choose the simplest change that is still provably correct.

## The gate: answer these before writing any code

A bug fix and a new feature clear the same gate. Answer every question in writing, with evidence, before the first edit. If an answer is unknown, get the fact first. A concise, justified “not applicable” is valid where the question does not apply.

**Understand: what changes, and why?**

1. State the goal in one sentence. For a fix, name the precise failure and a reproducible input. For a feature, name the behavior and the concrete need it serves.
2. Trace the affected path end to end. Does the defect originate where the symptom appears, or upstream? Which existing stage owns the behavior?
3. Read the code, prompt, or configuration being changed. What does it do now? What already exists that does part of this job?

**Simplify: is this the smallest correct change?**

4. Can an existing path or prompt be extended? Name it before proposing a new function, flag, stage, or service. Put a capability inside the library that owns it when that is the natural boundary.
5. If behavior lives in an LLM stage, can a prompt or configuration edit solve it? “Not applicable: no LLM stage” is a complete answer.
6. Does the proposed mechanism work on representative data? Name an input that defeats it. Do not build a guard that cannot distinguish the cases it must handle.
7. Does the plan deliver exactly the requested scope? Remove speculative work. Do not cut a hard requirement to make the implementation easier.

**Bound: how far does the change reach?**

8. List downstream callers, stages, formats, and tests that assert literal content. Search the whole test tree for changed strings and schema keys. If the change is structural, state the smallest surface that solves it.
9. What can the mechanism break or fail to detect? A filter that removes incorrect content may also remove correct content or miss omissions.
10. Does the change introduce a silent fallback or swallowed error? Remove it. Report failures at the boundary where they occur.
11. What changes in cost, cache behavior, and wall time? Separate interactive and background workloads. “No change” needs a reason tied to runtime inputs.
12. How is the change disabled, and what happens during deployment? Name the rollback or removal path, in-flight behavior, and any migration. Schema changes require explicit authorization because they mutate shared state even when a feature is disabled.

**Prove: how will you know it works?**

13. What end-to-end run proves the requested behavior? Name the authorized input, environment, and output artifact. Use representative data and inspect the actual output.
14. What baseline will you compare against? Account for every regression. If output cannot change, show why and use checks that exercise the changed surface.
15. Does verification reprocess shared data, affect users, or incur material cost? Establish authorization for those actions before starting. Existing authorization for the named action remains valid.

All fifteen answers precede implementation. “Small,” “obvious,” “internal,” “UI-only,” “cloud agent,” and “high autonomy” do not waive the gate. Mental answers do not count.

**One gate per scope.** Further iterations inside the cleared scope do not need a new gate. Re-clear it when scope or direction changes. If the answers already exist in a brief, cite their exact location.

**Short answers.** One line with evidence beats a paragraph of ceremony. Cite a file, measurement, or plan instead of repeating it.

**The lead writes it first.** Write the gate after scouting and before the plan review. Backfilling it after implementation defeats its purpose.

## 1. Keep the fix as simple as possible

Less new code is better when it delivers the full behavior. Extend a working path before adding a new abstraction. Earn every new artifact.

- Prefer prompt or configuration edits when they correctly solve behavior owned by an LLM stage.
- Test a proposed guard against inputs that share vocabulary but differ in meaning. Token overlap alone does not prove semantic correctness.
- Put limit handling inside the responsible library. Keep callers independent of its internal chunking or retry details.
- When a minimal fix is deliberately temporary, name the limitation and the durable remedy. Smallest-correct does not mean cheapest-looking.

## 2. Keep the blast radius as small as possible

A local-looking edit can affect shared prompts, schemas, events, and downstream consumers. Map the dependencies before writing.

- Bound structural changes explicitly. Keep one author responsible for converging each implementation diff.
- Keep unrelated concerns out of the change even when they are nearby.
- Name both false positives and false negatives. A new check changes failure modes as well as catching defects.
- No silent fallbacks or swallowed errors. Quiet degradation makes the blast radius harder to see.

## 3. Test, don't assert

Structural changes need end-to-end evidence. Unit tests are useful, but they do not prove the complete user-visible path.

- Inspect the actual stage output. A synthetic probe can omit the condition that caused the failure.
- Verify input provenance and process exit status before trusting a generated artifact. An old output file is not evidence that a failed replay succeeded.
- Use authorized, representative data in an isolated environment. Never publish private inputs as fixtures.
- Match the claim to the check. “Unit tests pass” and “verified end to end” are different claims.
- Silent omissions need an expected-output comparison. The absence of an error log proves little.
- Obtain authorization for costly or user-visible reprocessing. Reuse authorization already granted for the named operation.

## 4. Verify with evals

A quality-changing edit needs a baseline and a comparison across representative cases.

- Baseline first, then change, then diff. Report absolute cost and time beside percentages.
- Explain every regression. Distinguish actual loss, content relocation, and evaluation artifacts with evidence.
- Show improvements beside regressions. An unexplained loss does not disappear inside a better average.
- End-to-end evidence proves the intended behavior in a case. Evals test whether that change costs quality elsewhere.
- Skip irrelevant expensive checks when their runtime inputs cannot change, and explain why.

## How these compose

The sequence is the same for a fix and a feature: smallest correct change, bounded effects, end-to-end proof, then evaluation of wider quality when applicable.

Fast mode reduces plan-review depth. It does not remove the written gate, implementation review, or verification. Autonomy operates inside the loop.
