# Short task spec

Write this in the Linear issue. Copy agreed scope and criteria into the T3 task before dispatch.

```markdown
Outcome: who can do what, and why?
Scope: included behavior; explicit exclusions.
Criteria:

- AC1: given X, when Y, observable Z.
- AC2: failure case or existing behavior preserved.
  Proof: AC1 → check/result; AC2 → check/result; required environment.
  Context: inspected revision, relevant interfaces, settled/open decisions.
  Ownership: manager; worker when assigned; integration/acceptance owner.
  Dependencies: actual prerequisite outcomes, or none.
```

## Example: remote source permissions

Hypothetical; not approved work.

- Outcome: users understand why saving a source is unavailable.
- Scope: web/desktop/mobile; no automatic permission grants.
- AC1: missing `access:write` → save unavailable with an explanation.
- AC2: correct scope → normal save works.
- AC3: permission revoked after rendering → server rejects; client shows failure.
- AC4: checks use the selected environment's grants.
- Proof: real command-boundary tests and affected client checks; identify exact commands after repository inspection.
- Split only if useful: shared contract, independent clients, combined remote check.

Before dispatch: resolve blocking choices, confirm prerequisites, and name who checks the combined result. “Well tested” is not a criterion.
