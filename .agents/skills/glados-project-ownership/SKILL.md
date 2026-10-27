---
name: glados-project-ownership
description: "Define durable GLaDOS project leads, responsibility and handoffs. Multiple independent feature owners per project require runtime changes."
---

# Durable ownership

- **T3 lead:** identity, authority, retained context and event wake-ups.
- **Skill:** reusable procedure.
- **Codex definition:** optional role/model template; not an ownership record or something T3 automatically loads.
- Current limit: one lead per T3 project, including dormant leads; no subleads. Reuse it, never simulate feature owners with duplicate projects.

## Charter example

- Name: T3 Maintainer.
- Owns: remote connections and compatibility.
- Decides: implementation and split within the brief.
- Escalates: product scope, permissions or quality changes.
- Retains: repository/environment mapping, decisions/reasons, interfaces, Linear issue links, evidence, blockers and next action.
- Accountable for: combined verification.

## Lifecycle

- Sustained responsibility → `create-lead` within saved limits.
- Assign/reassign execution → `manage-task`; preserve identity and one writer.
- Retain context → `lead-context`; report → `lead-report`.
- Linear owns plans/specs; lead context retains working decisions, not another backlog.
- Dormancy → reconcile writers and transfer obligations; later reactivate the same identity.
- Relevant event → resume. Nothing actionable → end turn. Recurring maintenance needs its own authorized scope/cadence.

Persistence means retained responsibility, not keeping a model busy.
