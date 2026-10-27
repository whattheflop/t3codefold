# Linear ticket template

- Small fix → one issue.
- Large feature → parent with shared intent; children with independently verifiable outcomes.
- Native fields: team, project, priority, real assignee.
- Body: contract below. Comments: authorized progress/evidence.

```markdown
## Outcome

[Who can do what, and why?]

## Scope

Included: [...]
Excluded: [...]

## Acceptance

- [ ] AC1: [observable behavior]
- [ ] AC2: [boundary/regression]

## Proof

AC1 → [check + expected result]
AC2 → [check + expected result]
Environment: [...]

## Context

[Repository findings, shared decisions, unresolved choices]

## Ownership

T3 owner: [...]
Integration/acceptance: [...]
Prerequisites: [issue links + outcomes]
Work reference: [stable reference]
```

## Example split

[Remote-permission example](../../glados-work-preparation/references/task-specification.md):

- Parent: explain denied source writes across clients.
- Prerequisite: shared permission contract, if it needs changing.
- Children: web/desktop behavior; mobile behavior.
- Parent owns combined verification; avoid an overlapping integration task.

Register execution only for real work. Coordination-only parent issues do not need implementation workers.

Map existing team states: intake → ready → active → review → done. GLaDOS updates them through the CLI; T3 does not synchronize them automatically. Use native blocker relations. Done follows accepted evidence, not checkboxes.
