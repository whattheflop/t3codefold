# Coding-agent workflows: specifications, ownership and evidence

Reviewed **27 October 2026** at the maintainer's request. This synthesis supplements the existing idea catalogs with research on preparing and dividing coding work. It distinguishes benchmark experiments, first-party engineering reports, documented workflows and proposed GLaDOS adaptations. It is neither an execution plan nor authorization to change a live brief, tracker or verification policy.

The central recommendation is a small, repository-grounded loop: establish the requested behavior, implement bounded work, collect verification, review the result and make an explicit acceptance decision. Separate responsibilities where that prevents a demonstrated failure; a separate responsibility does not always require another agent.

## Local finding: Linear import was not a missing-skill problem

On 26 October, the configured Linear source used an organization/workspace ID where the adapter required a team ID. The query returned an empty issue list without a sync error. Correcting the selection imported four Linear onboarding examples, SMO-1 through SMO-4. GLaDOS then closed the managed candidates as outside its project brief, preserving reasons and creating no worker attempts or accepted results. The diagnosis and correction were performed by the assistant; the subsequent triage was performed by GLaDOS.

This distinguishes three different states: a successful request selecting no issues, imported candidates requiring triage, and eligible implementation work. A missing ready task does not by itself indicate failed autonomy. Adding a skill did not fix the import: the coordinator already had task creation, criteria, verification and delegation instructions. The work-preparation skill supplied reusable guidance over those capabilities.

The relevant boundaries are the Linear team filter in [TaskSources](../../../apps/server/src/pitboss/TaskSources.ts), polling/import in [SourceService](../../../apps/server/src/pitboss/SourceService.ts), candidate persistence in [WorkStore](../../../apps/server/src/pitboss/WorkStore.ts), and coordinator instructions in [Work](../../../apps/server/src/pitboss/Work.ts). This was a live import-and-triage observation, not a completed coding-task experiment.

Linear CLI 3.1.0 was subsequently installed on the Mac and Oracle; authenticated reads confirmed the intended workspace and team. That establishes CLI availability and read access, not tested write permissions. The built-in source adapter is read-only; ticket creation and workflow changes are separate CLI actions.

## Findings from the three initial research reviews

- **Keep a simple baseline.** Agentless used localization, repair and validation rather than an autonomous planning hierarchy. Its October 2024 evaluation resolved 32% of SWE-bench Lite at a reported average $0.70 per task. This is historical evidence for a useful structured baseline, not a current ranking or proof that fixed pipelines win on open-ended product work. Its generated-test analysis also cautions that reproducing a failure does not establish that the test captures the right requirement. [Agentless, v2](https://arxiv.org/html/2407.01489v2)
- **Choose parallelism by dependency structure.** The revised scaling study compared agent architectures across tasks and found strongly task-dependent benefits and losses, including degradation on coding and sequential work. Coding and terminal samples were small, and uncertainty limits generalization. This supports evaluating decomposition and coordination cost rather than assuming extra agents improve outcomes. [Towards a Science of Scaling Agent Systems, v3](https://arxiv.org/html/2512.08296v3)
- **Tests passing and acceptance are different outcomes.** METR's maintainers reviewed 296 agent patches across three repositories; roughly half of test-passing patches would not be merged after adjustment for review noise. Models were historical and agents could not revise in response to review. The result motivates review and revision, not a claim that half of current GLaDOS work will fail. [METR, 10 March 2026](https://metr.org/notes/2026-03-10-many-swe-bench-passing-prs-would-not-be-merged-into-main/)
- **Diagnose failures before adding roles.** MAST identifies failures including lost context, repetition, inter-agent misalignment, premature termination and missing verification. Its annotated traces provide a diagnostic taxonomy; they do not establish that a particular added role causes an improvement. [Why Do Multi-Agent LLM Systems Fail?, v3](https://arxiv.org/html/2503.13657v3)

## What more specific sources suggest

### Specify behavior before implementation detail

GitHub Spec Kit separates requirements and user stories from the technical plan, then creates dependency-ordered tasks and checks consistency between artifacts. Its requirements checklist is distinct from implementation completion, and its clarification/analysis steps are optional quality gates. This is a documented workflow, not a controlled demonstration of improved delivery. The useful distinction is between deciding what success means and deciding how to build it; importing the entire framework is unnecessary. [Spec Kit process reference, accessed 27 October 2026](https://github.github.com/spec-kit/reference/agentic-sdd.html)

Do not treat spec adoption as effectiveness evidence. SpecMine collects specifications and related repository/PR metadata at scale, but explicitly leaves how specifications become code as a research question. Its co-change relationships do not demonstrate that writing a spec caused a better implementation. [SpecMine, v1, 25 August 2026](https://arxiv.org/html/2608.25202v1)

### Ground the spec and plan in the actual repository

Spec Kit Agents adds repository discovery and validation around specification, planning, task generation and implementation. Its preprint evaluates 32 features across five repositories and reports modest gains in LLM-judged quality. Important limits: workflow families have different budgets, plan-review checkpoints are automatically approved, and its operational success definition includes producing a modified PR without critical execution errors. Repository test compatibility and a judge score are not maintainer acceptance. This is evidence worth testing for early grounding, not proof that PM/developer roles or a long specification pipeline outperform one agent. [Spec Kit Agents, v1, 7 April 2026](https://arxiv.org/html/2604.05278v1)

### Make a session's continuation explicit

Anthropic's November 2025 harness uses an initial setup phase followed by incremental coding sessions. It records feature expectations, environment startup steps and progress so a fresh session can orient itself and check existing behavior before continuing. This is an engineering report about its tested harness, not a universal requirement for two agents or a particular file format. For T3, preserve the useful state in existing task, evidence and project-context records rather than introducing a second authoritative backlog. [Effective harnesses for long-running agents](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents)

### Agree on observable proof and calibrate the reviewer

Anthropic's March 2026 harness had a generator and evaluator agree on testable behavior before implementation. Evaluators still needed calibration: some initially excused bugs or tested superficially. Its demonstrations used unequal budgets and expanded scope, so they do not isolate the benefit of the extra roles. The author later removed context resets and sprint structure as models improved. Borrow explicit acceptance contracts and actionable review findings; re-evaluate the cost of each orchestration stage rather than making the demonstrated three-agent setup mandatory. [Harness design for long-running application development](https://www.anthropic.com/research/harness-design-long-running-apps)

### Divide work around independently verifiable outcomes

Anthropic's compiler experiment used isolated checkouts and task claims, yet agents collided when they all encountered the same kernel-compilation blocker. A GCC comparison harness made failures more separable. This illustrates why checkout isolation alone does not produce independent work: the verification problem also needs decomposition. It is a capability demonstration with substantial human-designed infrastructure and no equal-budget single-agent control. [Building a C compiler with a team of parallel Claudes, 5 February 2026](https://www.anthropic.com/research/building-c-compiler)

Cursor reported better responsibility allocation after separating planners and workers, but also removed an integrator role because it became a bottleneck. These are workload-specific engineering observations, not evidence for a compulsory hierarchy or for abandoning integration checks. Retain an accountable integration owner; whether that responsibility needs a separate agent is an empirical choice. See the existing [Cursor catalog](cursor-projects.md#january-coordination-experiments) for its broader evolution. [Scaling long-running autonomous coding, 14 January 2026](https://cursor.com/blog/scaling-agents)

### Give each role enough context, with links to the rest

Anthropic's context-engineering guidance emphasizes concise instructions, retrieval and durable notes instead of continually adding everything to the prompt. This is practical guidance rather than a controlled coding-workflow comparison. For GLaDOS, a worker should receive its task contract, relevant interfaces and decisions, exact starting revision and evidence pointers; a coordinator needs a concise portfolio view. Detailed logs remain retrievable. A summary should not erase a blocker or turn an unverified claim into accepted knowledge. [Effective context engineering for AI agents, 29 September 2025](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)

## Proposed GLaDOS process

The following is an engineering synthesis for evaluation, not a new mandatory protocol. Existing [project leadership](project-leadership.md), [decision handling](task-decisions.md) and [verification](work-outcomes.md) remain the implementation references.

### 1. Prepare a proportionate task contract

For a small fix, the issue and its acceptance criteria may be enough. For a feature crossing interfaces or clients, record a short specification before parallel implementation. GLaDOS or the project lead drafts it; the user supplies genuinely unresolved product choices rather than filling fields.

The contract should identify:

- The user-visible outcome, concrete examples, exclusions and relevant regression constraints.
- The destination repository/environment and base revision, observed entry points, and compatibility requirements.
- Decisions already made, uncertain assumptions, real dependencies and the owner of unresolved decisions.
- What evidence will demonstrate success, where it will come from, and who can accept the outcome.

Separate product ambiguity from technical uncertainty. A bounded investigation or prototype can resolve an unknown interface or feasibility question before a detailed implementation plan. It must return evidence and a recommendation; its output is not automatically an accepted design. Revise the contract when evidence changes the plan, and identify affected work explicitly.

### 2. Assign responsibilities without manufacturing a team

| Responsibility                                        | Default owner                                                                | Boundary                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Product intent and decisions beyond the saved brief   | User, through GLaDOS                                                         | Routine implementation choices do not need repeated approval.                      |
| Scope, priority, readiness and task acceptance        | GLaDOS, or an authorized project lead for owned tasks                        | Cannot silently broaden the brief or weaken required proof.                        |
| Shared interfaces, decomposition and combined outcome | Existing task manager; project lead when sustained coordination warrants one | Must name who resolves cross-task decisions and owns integration.                  |
| Implementation and local checks                       | One tracked worker per bounded assignment                                    | Reports scope discoveries; does not redefine success to match its patch.           |
| Execution of configured verification                  | T3 verification runtime                                                      | A receipt establishes what executed against the candidate, not product acceptance. |
| Review of behavior, diff and evidence                 | Manager, with a separate reviewer when justified                             | A separate reviewer is advisory evidence, not an additional acceptance authority.  |

Review separation is about responsibilities, evidence and authority, not just model names. For difficult changes, a reviewer can first examine the requirement, diff and executed checks before reading the implementer's conclusion. That is a proposed way to reduce anchoring, not a measured cross-model advantage. GLaDOS can accept within the user's saved authority; this proposal does not require a human approval for every task.

### 3. Split work only where the boundary is useful

A task should deliver one outcome that can be checked independently and has a clear owner. Split after establishing shared contracts. Prefer coherent behavior slices where practical; a separate contract change can be a prerequisite when several clients consume it. Do not divide solely into frontend/backend/testing roles if each worker must repeatedly renegotiate the same behavior.

For example, a change to remote connection permissions might first establish the wire contract and compatibility behavior. Web/desktop and mobile work can then proceed against that contract in separate workspaces, with one named owner of the combined local/remote check. If implementation reveals that the contract is wrong, reconcile dependent tasks instead of letting workers invent divergent fixes.

Different files do not guarantee independent work, and separate worktrees do not prevent semantic conflicts. Shared migrations, generated artifacts and tightly coupled interfaces may require serialization. Do not launch several workers at the same undiagnosed blocker. Integration ownership need not be a permanent integrator agent, but it cannot be omitted because individual tasks passed.

### 4. Return an evidence-bearing handoff

An implementation handoff should contain the exact candidate, criteria version, changes, checks actually run and their results, artifact locations, remaining gaps and the next required action. Distinguish an unrun command from a passing check and an environment failure from a product failure. Keep concise current state and durable references rather than copying every worker transcript into every other context.

Review checks the requested behavior and relevant regressions, as well as whether changed tests, skips or configuration made a pass easier. A verifier should accept legitimate alternative implementations rather than enforce an unstated design. Stop writers before candidate verification; changes after verification require evidence for the new candidate. Record review and acceptance separately. Closing a superseded candidate is not successful completion.

### 5. Evaluate the process on real work

Compare a direct worker with additional planning or independent review on representative tasks using comparable models and budgets. Record specification changes, accepted outcomes, regression/reopen rate, review effort, rework, integration conflicts, elapsed time and cost. Include failed and deferred tasks so easy-task selection cannot inflate success.

Classify failures by the missing ingredient: unclear requirement, incorrect repository assumption, environment/tool failure, implementation defect, weak verification, coordination conflict or missing acceptance decision. Add a process step only when it addresses an observed failure, then check whether its benefit exceeds its overhead. Completion counts, lines changed, role count and green tests alone do not establish useful autonomous delivery.

## What this research does not establish

The reviewed evidence does not establish a universal specification length, optimal number of agents, mandatory planner/developer/tester roster, or a reliable benefit from switching models for review. It also does not validate sustained autonomous delivery for this GLaDOS installation. The next useful evidence is a real bounded issue taken through preparation, implementation, verification and acceptance, followed by related work that tests context retention and integration.

## Skills and ownership boundary

The workflow is expressed in [work preparation](../../../.agents/skills/glados-work-preparation/SKILL.md), [Linear coordination](../../../.agents/skills/glados-linear-work/SKILL.md), and [project ownership](../../../.agents/skills/glados-project-ownership/SKILL.md). Repository skills must be deployed to the provider's discovery path; changing these files alone does not update a running GLaDOS.

A named owner should retain responsibility and context between event-driven turns, rather than continuously consuming model calls. The current lead contract permits one lead per T3 project, even if dormant. Multiple feature headings in that lead's context are useful organizational records, but are not separately authorized feature-owner agents. Independent feature owners within one project would require a runtime change; persona prompts alone cannot provide ownership or wake guarantees.

The minimal setup uses the existing `linear` CLI and these skills. GLaDOS maintains Linear specs, statuses and relationships explicitly, while T3 retains its existing board, worker ownership and verification records. Source imports remain candidates requiring preparation. Statuses, dependencies and comments are not automatically synchronized. The `glados-linear` launcher isolates app credentials from the personal CLI login; app authentication must be verified before use. Native mention/delegation handling is deferred.
