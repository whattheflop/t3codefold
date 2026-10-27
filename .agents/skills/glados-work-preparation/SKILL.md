---
name: glados-work-preparation
description: "Prepare Linear issues for GLaDOS execution: scope, acceptance, dependencies and verified worker handoffs. Use for triage and splitting; Linear is the planning board."
---

# Prepare work

- Read `work_read` for authority, running work and evidence; Linear holds the plan.
- Use [Linear work](../glados-linear-work/SKILL.md) for direct planning; workers implement and test.
- Relevant issue → prepare. Technical uncertainty → bounded investigation. Product ambiguity → request a decision. Outside brief → leave unclaimed.

## Spec and split

- Put outcome, exclusions and observable acceptance criteria in the [Linear issue spec](references/task-specification.md).
- Inspect the repository before choosing implementation or checks.
- Split by independently verifiable outcomes. Shared interfaces first; separate files alone do not mean independent work.
- Name implementation, integration and acceptance owners. Use [durable ownership](../glados-project-ownership/SKILL.md) when sustained context helps.

## Dispatch

- Re-read the issue, status, unresolved blockers and repository mapping. Cancelled, completed or blocked issues are not ready.
- Reuse the imported T3 candidate. If no source imports it, create bounded work with the issue URL in its outcome; check existing work first. Do not create a second task for an issue awaiting import.
- Fill outcome, criteria, verification, priority and T3 dependencies using current `work_command` schemas. Copy agreed requirements explicitly; Linear blockers are not imported as T3 dependencies.
- Select suitable verification. Missing hardware/tools means blocked proof, not weaker criteria.
- Assign through `work_command`; reuse retained work within saved limits.
- Spec change → update Linear, stop affected writers, revise T3 criteria. Old evidence cannot accept new requirements.

## Finish

- Handoff: exact candidate, criteria version, checks/results, artifacts and gaps.
- Stop writers → verify → review → accept. Passing children still need combined verification.
- Re-read Linear, publish result/PR and evidence, then set its configured Done status. Preserve human changes.
- Handle outstanding obligations; end idle turns.
