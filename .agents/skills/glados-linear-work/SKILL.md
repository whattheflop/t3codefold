---
name: glados-linear-work
description: "Manage Linear issues through the isolated glados-linear launcher: specs, statuses, sub-issues and blockers. Use for GLaDOS planning and reporting within the saved brief."
---

# Linear work

Linear holds the plan. GLaDOS manages tickets within the saved brief; workers implement and test. Ask for decisions outside that scope.

## Start

- Use `~/.local/bin/glados-linear`; it runs the installed Linear CLI with separate app credentials. Plain `linear` remains the personal login.
- Check `glados-linear --workspace WORKSPACE auth whoami` and `team list --json`. Require the intended app identity; missing app login is a blocker, not permission to use the personal account.
- App credentials live under `~/.config/glados/linear/`. Setup uses `glados-linear auth login --plaintext` with a hidden `Bearer TOKEN` prompt. Do not run `auth migrate`: the system keyring is shared with the personal CLI.
- Read `work_read`, existing issues and the repository/environment mapping. Workspace ID ≠ team ID; a Linear project is not a repository.
- Check subcommand `--help` before unfamiliar operations. Never print credentials.

## Plan

- Search before creating. Use a stable work reference; retain issue UUID, identifier and URL.
- Specs/criteria → description; shared specs → documents; separate outcomes → sub-issues; prerequisites → blocking relations.
- Read before editing; preserve human changes. Supply prose through files.
- Use actual team statuses and real assignees. Cycles/milestones only when useful.

```sh
glados-linear --workspace WORKSPACE issue query --team TEAM --search WORK_REF --json
glados-linear --workspace WORKSPACE --no-input issue create --team TEAM --title TITLE --description-file FILE --state STATE --yes
glados-linear --workspace WORKSPACE issue relation add CHILD blocked-by PREREQUISITE
```

- `--parent PARENT` groups work; it does not establish a blocker.
- Read back writes. After an uncertain result, inspect before retrying; search is not atomic deduplication.

## Execute and report

- Follow [work preparation](../glados-work-preparation/SKILL.md); reuse imported T3 tasks, avoiding duplicate execution.
- Recheck specs, status and blockers before dispatch. Reconcile cancellation or changed requirements with active writers.
- Update Linear status through the CLI: active → review → done after accepted evidence. Comments record decisions, blockers and results/PR links.
- T3 imports candidates; it does not automatically synchronize statuses, dependencies or comments. Check those yourself during relevant turns; do not poll in a loop.
- A human marking Done is not T3 verification. End idle turns.

Use the [ticket template](references/linear-tickets.md).

Launcher: [scripts/glados-linear](scripts/glados-linear). Install it at `~/.local/bin/glados-linear`; it requires `linear` on PATH.
