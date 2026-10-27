# GLaDOS scope and iteration constraints

This catalog is retained in the repository at the maintainer's request so future GLaDOS iterations can draw on the source research. It is a design reference, not executable agent instructions or an automatically authorized backlog. Catalog dispositions were recorded during initial design; “MVP” there describes a proposed invariant, not proof it shipped.

## Product constraints

- GLaDOS is the user’s single conversational point of contact. Project leads and workers report through it; the user does not have to manage the internal hierarchy.
- An elected, pinned thread per environment retains the user's priorities, quality expectations, and limits. Proactive work stays within those agreements.
- Environments are independent by default. There is no mandatory global leader. A shared coordinator change requires explicit approval at both participating environments; silence or an offline peer never grants authority.
- T3 owns durable task identity, attempts, messages, context and acceptance. Providers remain interchangeable. A task, a conversation, and an execution attempt are distinct identities.
- Cheap workers receive bounded assignments and meaningful verification. A stronger worker can resume a stopped candidate without discarding its history. Model price is not evidence of correctness.
- Personal work, exploration, home-server operations, game development and tool improvement need different evidence. External tracker workflow and T3 acceptance remain distinct.
- User decisions park individual tasks and their dependencies. GLaDOS and project leads continue independent work; recommendations, acknowledgements and silence never resolve a gate. See [task decisions](task-decisions.md).

## Adaptive delegation

The agreed design is workload-dependent delegation, not a permanent project-lead layer. GLaDOS chooses a direct worker for bounded work and creates or reuses a project lead when a body of work needs ongoing decomposition, dependency management, multiple workers or combined-outcome review. Task count alone is not the criterion: one difficult but self-contained task can still go directly to a capable worker.

A project lead owns the project’s working context, local design decisions and coordination within its assigned charter, and reports outcomes, blockers, changed assumptions, evidence and decisions needed to GLaDOS. Its durable project record preserves current goals, interface decisions, reasons, verified working methods and open questions; its conversation is not the only copy of that knowledge. GLaDOS retains portfolio priorities, capacity allocation and communication with the user. Leads do not become separate conversational obligations for the user or independently expand their authority.

Proposed lifecycle rules: reuse a suitable active lead rather than creating duplicate ownership; introduce a lead when direct work grows into a coordinated workstream; make the lead dormant when that coordination is no longer needed, retaining its project knowledge for later work. Preserve task identities, evidence and writer ownership during either transition. Delegated work must share the allocated capacity rather than receiving a fresh allowance at each level. Choosing a local worker or lead within the agreed brief should be autonomous; changing shared coordination between environments still requires explicit user approval.

See [project leadership and context ownership](project-leadership.md) for the proposed authority, context and reporting boundaries.

Project leads and this adaptive lifecycle are tracked in [PR #16](https://github.com/BreakTheBeta/T3codefold/pull/16); consult its merge status for availability. The [first implementation boundary](project-leadership.md#first-implementation-boundary) distinguishes the bounded implementation from the broader design. A useful proof is that small work stays direct, a growing workstream gains a lead without duplicate writers, and the user continues receiving decisions through GLaDOS throughout.

## Implemented pilot and remaining ideas

The pilot includes durable brief/task state, context injection, bounded assignment and retained-worktree takeover, worker-reported evidence and coordinator acceptance, and a shared MCP/CLI work contract. Web/desktop and mobile expose the role and work controls. Read-only task adapters cover Vikunja, Jira and Linear.

Configured verification profiles require current server-captured receipts bound to their candidate and criteria before acceptance. Reported-evidence tasks still rely on agent and coordinator judgment. The server does not require a separate reviewer model; see [outcome verification](work-outcomes.md).

Two peers may coordinate a shared tracker scope with durable commands, task observations, messages and application receipts. Work executes at its fixed task home. Coordinator changes preserve that home and require resolved workers. This is a deliberately small peer protocol, not general multi-party consensus or automatic failover.

Live experiments exercised a local execute/verify/accept loop, remote assignment and acceptance with browsers closed, deliberately failed Luna work resumed by Sol in the same worktree, and restart preservation. Vikunja was tested live; the initial Jira/Linear checks used fixtures. On 26 October 2026, a live Linear source imported four onboarding candidates after its workspace ID was corrected to a team ID, and GLaDOS closed them as outside its brief without worker attempts. See the [workflow research](agent-workflows.md#local-finding-linear-import-was-not-a-missing-skill-problem) for the distinction between import, triage and executable work. The decision inbox was exercised in an Android emulator at phone and Fold-class sizes, including density changes, retained drafts, offline/reconnect behavior and a persisted answer. These checks do not establish physical-device or iOS coverage, live Jira coverage, Linear writeback or sustained performance on large projects.

Revisit these gaps when the corresponding need is observed:

| Need                                     | Candidate iteration                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| More than two peers or movable execution | Separate authority, task-home migration and execution placement; require explicit reconciliation and fencing       |
| Long-running or high-volume backlog      | Paged projections, task-history retrieval, evidence retention and durable wait subscriptions                       |
| Stronger verification provenance         | Server-captured artifacts, verifier maintenance, known failing checks and criteria/candidate binding               |
| Predictable resource usage               | Time/money budgets and measured escalation policies; existing limits are not a process sandbox or global spend cap |
| Richer recurring work                    | Versioned recipes, triggers, gardening budgets and useful-work measurements                                        |
| External tracker mutation                | Field ownership, checkpointed sync, idempotent writeback and explicit conflict handling                            |
| Broader provider confidence              | Real provider/native-client matrices and fault-injection exercises                                                 |

Use the [crosswalk](crosswalk.md) to select concepts and their stable GC/PS IDs. Add a concrete outcome and a failure-capable check before extending the protocol. Historical throughput claims from the supplied pstack articles remain author reports, not validation of this implementation.
