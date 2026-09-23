# Decision: Audit repair closes through evidence gates

Status: implemented

[中文](2026-09-19-audit-repair-evidence-gates.md) | English

## Problem

The 2026-09-19 read-only audit ran against a dirty working tree, so it cannot establish a byte-level pre-change baseline for every dirty file. Most defects it found (a lost manifest, missing cancellation propagation, an over-wide permission policy, an acceptance script that no-ops) are the kind where all local checks stay green and the problem still ships. If the repair closes on "tests passed" alone, it cannot separate environment failures, pre-existing failures, regressions from this round, and blockers introduced by concurrent work, and it cannot stop the same defect from escaping the same way again.

Real-run validation also has two related maintenance risks. Some acceptance drivers create their test workspace with `git init` / `add` / `commit`, which conflicts with an explicit no-commit task constraint; relaxing the constraint merely to run smoke makes the acceptance procedure mutate its own prerequisite environment. Concurrent tasks in a dirty working tree can also break downstream gates; if the current task repairs or reverts somebody else's uncommitted changes merely to "finish the plan", it crosses the change-ownership boundary. In that state, downstream gates that never ran cannot be called PASS, and the work line should not remain indefinitely "pending" after the user has explicitly stopped it.

## Decision

Audit repair in this repository closes through evidence gates. Each phase defines an observable acceptance state first, then runs the focused tests, governance/documentation gates, and feasible real-run verification that match the touched surface. Failures are attributed as environment issues, pre-existing failures, regressions from this round, or concurrent-work blockers and are recorded as such. Invariants a machine can judge (manifest fields exist, the timeout still fires, acceptance distinguishes SKIP from PASS, performance evidence has complete input identity) become gate scripts or contract tests instead of review memory. Plans and owning decision records are maintained in the same batch as non-trivial implementation, and phase evidence is stored as independently readable records for review.

Real-run drivers obey task-level side-effect constraints. When a task forbids creating commits, smoke uses an explicit existing-Git-workspace mode: it only reads the caller-provided workspace while temporary `userData` / `dsh-home` and result files remain isolated. That mode does not execute `git init`, `git add`, `git commit`, checkout, branch creation, or worktree creation, and cleanup does not delete the caller-provided workspace. The default smoke behavior continues to serve existing callers that are allowed to construct their own workspace; restricted tasks explicitly select the no-commit mode.

When a gate is blocked by concurrent uncommitted changes outside the current task's ownership, the task records the first failure's exact file, error, and execution stage and does not repair, revert, or weaken assertions to finish another workstream's code. Downstream steps that depend on that gate are **NOT RUN** and cannot inherit a historical PASS. If the user then explicitly stops the work line, it closes as **CLOSED WITH RESIDUAL WORK**: evidence already completed remains valid, while blockers and unexecuted items remain explicit; "work line closed" does not mean "all acceptance completed" or "release ready".

## Alternatives considered

* **Close on one full `npm test` run** — rejected: the full result mixes environment failures, and when the manifest is lost the full suite cannot even start, so it cannot cover this defect.
* **Repair first, add gates and documentation afterwards** — rejected: the maintenance system requires non-trivial changes to carry decision records in the same batch; a later retro-fill separates "why this was decided" from the implementation and lets the defect regress silently.
* **Treat the audit's W-only findings as HEAD defects** — rejected: that misreports working-tree state as an upstream defect and pollutes the factual layer.
* **Create a temporary commit inside a restricted task just to make smoke run** — rejected: acceptance should not manufacture a prerequisite by violating the task's constraint; an existing-workspace mode can exercise the same product probes without creating a commit.
* **Repair or revert another concurrent workstream's uncommitted code so the build can continue** — rejected: that crosses change ownership and disguises another product defect as a repair owned by this audit task.
* **Leave the plan permanently pending after the user explicitly stops it** — rejected: status should reflect reality; the work line may close, but unexecuted gates remain NOT RUN / NOT MEASURED instead of closure being equated with completion.

## Consequences

Evidence gates make the local repair loop longer, but each phase's commands, exit statuses, key output, blockers, and unexecuted items remain independently reviewable; SKIP is not PASS, and an unexecuted gate cannot borrow a historical result and become PASS. No-commit smoke mode depends on the caller supplying an existing Git workspace that is safe to use read-only, so it does not remove the need to check isolation. Concurrent-work build failures can leave source-smoke, packaging, or other downstream evidence unavailable; preserving those gaps is safer than crossing ownership boundaries to repair them. `CLOSED WITH RESIDUAL WORK` means only that the work line has stopped with its residual items recorded; it is not release certification, so installer, remote, credential, real-publication, and other unexecuted surfaces retain their own manual or environment acceptance requirements.
