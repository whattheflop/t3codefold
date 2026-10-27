# GLaDOS orchestration idea library

This is the reference library to consult while designing and iterating on T3's GLaDOS. It preserves source mechanisms and useful alternatives independently of the implementation. Start with [current scope and iteration constraints](scope.md).

See [portfolio outcomes and evidence profiles](work-outcomes.md) for software, games, music, research, device and home-server work.

See [outcome verification proposal](verification-proposal.md) and [its architectural decision](../../adr/0001-captured-verification.md).

See [project leadership and context ownership](project-leadership.md) for workload-dependent delegation and durable project decisions.

See [coding-agent workflow research](agent-workflows.md) for specification-first preparation, responsibility boundaries, work decomposition, evidence limits and the live Linear import finding.

See [worker model choices and routing](worker-model-policy.md) for the native editor and per-task selection policy.

See [decisions without blocking coordination](task-decisions.md) for task-scoped user questions and the mobile decision inbox.

## Browse by question

| What you want to explore                                          | Start here                                    |
| ----------------------------------------------------------------- | --------------------------------------------- |
| How should durable tasks, messages and recovery work?             | [Gas City](gas-city.md)                       |
| How can workers prove their work and improve quality?             | [pstack](pstack.md)                           |
| What can we learn from Cursor Projects and agent swarms?          | [Cursor](cursor-projects.md)                  |
| How should specialist teams hand off work and learn?              | [Hermes](hermes-media-team.md)                |
| When should GLaDOS create a worker or a project lead?             | [Project leadership](project-leadership.md)   |
| How should specs, responsibilities and work boundaries be chosen? | [Coding-agent workflows](agent-workflows.md)  |
| How should models and thinking levels be chosen?                  | [Worker model policy](worker-model-policy.md) |
| Which ideas fit a particular T3 limitation?                       | [Crosswalk](crosswalk.md)                     |
| What is implemented, proposed or deliberately deferred?           | [Scope and constraints](scope.md)             |

Each catalog's headings are browsable through GitHub's outline. Search within a page for stable concept IDs or a topic such as verification, messaging, memory or recovery.

The project-lead implementation is tracked in [PR #16](https://github.com/BreakTheBeta/T3codefold/pull/16). Its documented first-implementation boundary describes that change; publishing these ideas does not merge its runtime code.

## Catalogs

- [Gas City concepts](gas-city.md): durable work, roles, routing, mail/nudge, claims, waits, workflows, lifecycle/recovery, configuration, runtime placement, accounting and observability.
- [pstack concepts](pstack.md): principles, task playbooks, context/research, design/prototyping, verification, orchestration records, tools, parallelism and maintenance.
- [Cursor Projects and orchestration concepts](cursor-projects.md): September 2026 Projects, shared memory, subscriptions, swarm evolution, durable execution, placement, routing and proposed GLaDOS experiments.
- [Hermes media-team concepts](hermes-media-team.md): decision ownership, evidence-first handoffs, package review, selective memory and human-approved learning from a supplied editorial workflow.
- [Crosswalk and adoption decisions](crosswalk.md): choose a mechanism by problem, see how the sources differ, and understand the T3 adaptation.

The current library contains **189 concepts: 68 Gas City, 75 pstack, 30 Cursor and 16 Hermes media-team**. Coverage is recorded in the [Gas City source inventory](gas-city-source-inventory.md), pstack's catalog inventories, and the [pstack source manifest](pstack-source-manifest.json). Inventory coverage and detailed implementation inspection are explicitly different levels.

Concept IDs (`GC-…`, `PS-…`, `CU-…`, `HM-…`) are stable references. Future edits should preserve IDs, revise inaccurate claims in place, and add explicit replacement pointers rather than renumbering unrelated concepts.

## How to use a concept

1. Name the actual constraint or failed behavior.
2. Find the source concept and inspect its mechanism, not just its name.
3. Read its enforcement level and caveats. A prompt instruction, an optional gate and an atomic storage rule have different strengths.
4. Check the T3 adaptation and the MVP decision before adding machinery.
5. Define a failure-capable proof through the module's real interface.
6. Capture the accepted lesson in code, a test, a tool or a focused maintained instruction. Update this catalog when an iteration changes an adoption decision; keep temporary execution notes outside the worktree.

## Evidence vocabulary

- **Implemented:** observed in source at the stated revision. Static inspection is not end-to-end runtime validation.
- **Prompt/playbook:** an instruction for an agent to follow; compliance is not enforced merely because it is written down.
- **Optional enforcement:** a gate exists but configuration can leave it disabled, advisory or permissive.
- **Documented:** a source describes the behavior; implementation confirmation is stated separately.
- **Author report:** claims in supplied articles and first-party reports, including productivity figures, without independent performance verification.
- **T3 proposal:** our intended adaptation, not an assertion about either source or current T3.

## Coverage and limits

The user asked to preserve every detail, implementation, tip, idea and interesting concept. This library aims at a comprehensive, navigable inventory of the pinned source material and supplied posts relevant to agent work. It does not claim that every line in either repository has been audited or that every optional backend has been executed. Each catalog carries its source revision, inventory and coverage status, including references not inspected deeply and known gaps. The full pinned sources are the authoritative place for implementation details beyond the concept entries; sources were not copied wholesale into these notes.

Catalogs record concrete mechanisms, operational tips, failure cases, source/implementation disagreements and non-MVP alternatives so those ideas remain available during iteration. A catalog recommendation is not authorization to run it: repository restrictions on live state, browsers, tests and external actions still apply.

Sources evolve. Compare a new source revision against the recorded revision before changing a concept; preserve meaningful changed defaults and discarded mechanisms as clearly historical notes rather than silently applying outdated behavior to the MVP.
