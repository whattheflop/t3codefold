# Hermes media-team concepts

The supplied media-company example contributes an editorial workflow rather than a fundamentally new orchestration architecture. Its strongest additions are the quality of the handoff contract, deliberate rejection of weak work, review of the whole output package, and a controlled path from feedback to shared knowledge. These are useful beyond publishing: GLaDOS manages outputs whose quality cannot always be reduced to passing tests.

Source: the full article supplied in conversation, **“How to Build a One-Person Media Company With Hermes Bots,” attributed in its closing text to @vibemarketer\_**. No original article URL or publication date was supplied. Article claims are labeled separately from official Hermes documentation. The reported 5.8 million X impressions in four weeks is unverified and does not establish causation, business value, review cost, or reliability. “Trained” is interpreted here as configured context, instructions and examples; the article does not demonstrate model-weight training.

## What changes our thinking

The architecture largely reinforces Gas City, pstack and Cursor: durable tasks, isolated execution contexts, shared knowledge, explicit roles, verification and recurring maintenance. The useful shift is from “several agents complete tasks” to “a sequence of decisions produces a coherent package, then human judgment improves the next package.” Novelty below is relative to our existing booklet, not a claim that the author invented these mechanisms.

| Emphasis                                           | Relationship to existing concepts | What this example sharpens                                                       |
| -------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| One decision, artifact and stopping point per role | CU-010; PS-022–023                | A five-part contract suitable for subjective and non-code work                   |
| Filter candidates before expensive execution       | GC-030–031; CU-018                | Rejection reasons and opportunity expiry belong in the intake record             |
| Facts precede the chosen thesis                    | PS research/verification; CU-014  | A separate evidence packet can constrain persuasion and narrative                |
| Review all outputs together                        | CU-011, CU-014                    | Correct individual artifacts can still form a redundant or contradictory package |
| Human decisions train future operations            | PS reflection; CU-020, CU-027     | Explicit promotion from tentative lesson to approved shared rule                 |
| Adapt output to its destination                    | Multi-surface T3 requirement      | Preserve intent while changing presentation, instead of mechanically copying     |
| Temporary material stays out of shared knowledge   | CU-015, CU-017                    | Campaign workspace and accepted knowledge have different retention policies      |

## Stable concepts

### HM-001 — Roles own decisions, not job titles

**Article mechanism:** Each role declares what it owns, reads, returns, must not do, and when it is done.

**T3 proposal:** Represent a task recipe with those five fields. For a home-server change, a diagnostician owns the diagnosis, a repair worker owns a bounded candidate, and a verifier owns the observation. GLaDOS owns prioritization and escalation. These can be temporary assignments rather than permanent agents.

**Proof:** Two tasks cannot both silently claim ownership of the same interface decision. An implementer returns an unresolved design question instead of changing the architectural brief.

### HM-002 — Reject work before allocating execution

**Article mechanism:** The scout reports urgency, audience relevance, source material, a question worth answering, and reasons to reject the opportunity.

**T3 proposal:** Add relevance, confidence, expiry and rejection reason to candidate triage. Home-server alerts, game experiments and dependency updates should not all become implementation tasks merely because an agent can do them. Retain concise rejection rationale to avoid repeatedly reconsidering the same weak suggestion.

**Proof:** Duplicate or expired alerts produce no new worker. A low-value idea remains a candidate rather than consuming the ten-worker allocation.

### HM-003 — Separate evidence gathering from advocacy

**Article mechanism:** Research produces claims, sources, contradictions, unknowns and limits before the strategist chooses a thesis.

**T3 proposal:** Require an evidence packet before committing to an expensive explanation or redesign. Include observations that count against the preferred solution. A persuasive summary is not evidence that the proposed root cause is correct.

**Proof:** A reproduction disproving the initial bug hypothesis changes the proposed work instead of disappearing from its brief.

### HM-004 — Carry intent through every transformation

**Article mechanism:** Downstream distribution receives the angle and evidence, not just a finished article.

**T3 proposal:** Every derived artifact keeps its parent outcome, constraints and evidence references. A mobile implementation should receive the original interaction goal; an operations runbook should receive the actual failure model. Otherwise each handoff compresses away another important constraint.

**Proof:** A second implementation surface preserves the original behavior and accessibility requirement even when its layout is different.

### HM-005 — Missing handoff data is a return path

**Article mechanism:** A missing required field sends the task back to the preceding stage instead of inviting a plausible guess.

**T3 proposal:** Validate required artifacts at transition boundaries and return a precise repair request to their owner. Distinguish unavailable evidence from optional detail. Record handoff versions so changing an upstream decision can invalidate affected downstream work.

**Proof:** Missing verification environment or acceptance criteria blocks execution with an actionable request. A corrected packet resumes the existing obligation rather than creating a duplicate campaign.

### HM-006 — Review the whole package

**Article mechanism:** The editor sees every campaign asset together and checks repetition, contradictions, uneven quality and mismatched calls to action.

**T3 proposal:** Add outcome-level review after task-level checks. Several independently passing PRs can still introduce duplicate abstractions, incompatible terminology or inconsistent web/mobile behavior. Package review should evaluate those relationships, not merely repeat each worker's tests.

**Proof:** Two valid components with conflicting interaction conventions fail the combined review. A correction is routed to the specific owning task.

### HM-007 — Destination-native outputs share intent, not shape

**Article mechanism:** Distribution reconstructs useful standalone treatments rather than shortening one article repeatedly.

**T3 proposal:** For web, desktop and mobile, define the shared user outcome and each surface's interaction constraints. For research deliverables, distinguish a maintainer explanation, an operational procedure and a user-facing guide. Do not count several mechanically reformatted artifacts as several useful outcomes.

**Proof:** Each artifact can be used by its intended audience without opening the others; all remain consistent on consequential facts and behavior.

### HM-008 — Make approval self-contained

**Article mechanism:** The approval queue includes final copy, supporting evidence, destination, media and the decision needed.

**T3 proposal:** Present candidate revision, visible result, verification receipt, intended action and unresolved concerns together. Bind an approval to that exact candidate. A human should not need to reconstruct six conversations to understand what they are approving.

**Proof:** Modifying the candidate after approval requires a new decision. The review card makes a missing artifact explicit rather than showing an undifferentiated green state.

### HM-009 — Separate drafts from accepted knowledge

**Article mechanism:** Campaign drafts have their own space; shared memory contains accepted rules, examples and reusable knowledge.

**T3 proposal:** Give experimental notes a different lifecycle from standing instructions. Workers may suggest a lesson, while promotion carries provenance, applicability and a decision record. Selectivity should increase with history; growing storage is not itself learning.

**Proof:** A rejected experiment remains auditable but is absent from default instructions sent to a fresh worker.

### HM-010 — Feedback creates hypotheses before rules

**Article mechanism:** Weekly review produces keep/test/stop proposals supported by named posts; one strong result does not establish a universal rule. The human approves permanent changes.

**T3 proposal:** Use observation → hypothesis → trial → accepted rule → superseded rule. Measure repetition, counterexamples and the context where a lesson applies. User-approved leadership and permissions remain separate from learned preferences.

**Proof:** One successful cheap-model attempt creates a trial proposal, not a permanent “always use this model” rule. A contradictory trial is retained.

### HM-011 — Capture the reasons behind human corrections

**Article mechanism:** Approvals, revisions and rejections become examples of editorial judgment.

**T3 proposal:** Record why a result was rejected: correctness, excessive scope, weak evidence, maintainability, visual taste, or wrong priority. This is more informative than a binary success signal. Let the user inspect and correct inferred preferences before they influence unrelated work.

**Proof:** “This spacing is inconsistent with native T3 controls” becomes a scoped UI criterion, not a blanket prohibition on new designs.

### HM-012 — Separate acceptance from publication

**Article mechanism:** The editor can approve or reject an asset but cannot publish; the first system prepares everything and publishes nothing.

**T3 proposal:** Keep “meets task criteria,” “approved for external action,” and “external action completed” as different states. An accepted patch is not automatically permission to merge or deploy. A publication receipt should identify the artifact and destination actually used.

**Proof:** Editorial or technical acceptance alone cannot trigger a production deployment. Existing session authorization can satisfy a publication gate when its scope and candidate requirements are met.

### HM-013 — Roles need not be permanently staffed

**Article mechanism:** Performance review is a weekly editor task rather than a seventh bot; the team starts with three roles and expands after handoffs prove useful.

**T3 proposal:** Store reusable role recipes and instantiate them when the work needs them. Add a role to solve demonstrated overload, context contamination or conflicting responsibility—not to make the roster resemble a company.

**Proof:** A scheduled learning review consumes bounded capacity and then exits. Routine tasks do not pay for six sequential agent sessions by default.

### HM-014 — Validate the workflow with one inspectable outcome

**Article mechanism:** Start with a small researched opportunity and approval-ready post, then add richer outputs and the feedback loop.

**T3 proposal:** Exercise the entire handoff chain on one small task, including a rejected handoff, a requested revision and an accepted result. Validate the weak links before scaling the number of workers or initiatives.

**Proof:** A deliberately unsupported claim reaches review as a failure, returns to its owner, and is corrected without losing provenance or silently widening scope.

### HM-015 — Enforce completion contracts at the transition

**Official Hermes documentation:** PR contracts identify the intended PR and require checks on its current head; missing evidence prevents completion. [Pinned Kanban reference](https://github.com/NousResearch/hermes-agent/blob/45a6101f36576367359c171cd5820ee76a3d047b/website/docs/user-guide/features/kanban.md).

**T3 proposal:** A task's acceptance contract should specify the exact artifact and required receipts. Apply it consistently to UI, MCP, CLI and remote completion. Current GLaDOS acceptance checks the worker's reported evidence; this stronger boundary is a proposed improvement, not a guarantee we already have.

**Proof:** A green check for yesterday's commit cannot approve today's candidate. A different completion entry point cannot bypass the contract. Passing CI still does not prove subjective quality or cover unspecified behavior.

### HM-016 — Revision and retry are different routes

**Official Hermes documentation:** Reviewer-requested changes return to the implementer; infrastructure retries are a separate concern. [Pinned Kanban reference](https://github.com/NousResearch/hermes-agent/blob/45a6101f36576367359c171cd5820ee76a3d047b/website/docs/user-guide/features/kanban.md).

**T3 proposal:** Classify rejection as missing input, changed requirements, execution failure, failed verification or subjective revision. Preserve the correct owner and artifact lineage. A request to change tone should not consume the same recovery policy as a crashed provider, and neither automatically justifies switching to a stronger model.

**Proof:** A reviewer requests one change; the existing deliverable returns to its owner with that reason. An infrastructure retry preserves the original acceptance criteria.

## Assumptions to resist

**A graph is not a consistency protocol.** Markdown links make knowledge navigable. They do not settle concurrent writes, stale references, permission boundaries or which rule wins. Sharing one vault with instructions about expected edit paths is not filesystem isolation. T3 still needs explicit authority and artifact versioning.

**A role checklist can become an expensive assembly line.** Six serial stages create queueing, repeated context loading and more opportunities for intent loss. Use the stages where their independent decisions matter; combine or skip them for small, well-understood work. Keep a route for questions and exceptions instead of forcing every task through a fixed theatrical hierarchy.

**The example seeds its desired conclusion.** It asks the scout to find the strongest opportunity from the release, then says it should return this exact media-company workflow. That is a useful teaching scenario but weak evidence of independent discovery. Our evaluation should permit rejection and surprising alternatives; it must not reward reproducing the story used to define the test.

**Reach is not a causal quality measure.** Impressions can reflect topic timing, existing audience, distribution volume or platform changes. Optimize the intended outcome and record negative effects and total production/review cost. Comparisons across different platforms or subjects are not automatically controlled experiments.

**Human review can remain the bottleneck.** A queue of six-agent campaigns can exceed one person's attention. Bundle evidence, show only material decisions, and measure review time and reversals. “Boring review” is encouraging but can also mean repetitive work or inattentive review; require outcome evidence before expanding autonomy.

**One shared brain can mix incompatible standards.** Brand policy is a good shared scope for this media team. Our personal projects, different employers and home-server operations do not share one universal policy. Shared recipes may be reusable, while credentials, private evidence and business priorities remain separately scoped.

## GLaDOS implications

The highest-value next adaptation from this example is a structured result packet plus an outcome-level review. The packet should preserve what was intended, what evidence supports the candidate, which assumptions changed, what remains uncertain, and the exact next decision. A second improvement is a visible lesson-promotion queue: GLaDOS can propose what it learned without silently rewriting standing rules.

A useful experiment is to take one T3 UI behavior through web and mobile. Research the native conventions, choose the shared interaction outcome, implement surface-specific candidates, and review the pair together. Capture a user's correction as a proposed scoped lesson. That tests HM-004–011 more directly than creating six permanently named bots.

These concepts add no new permission for publication, external messages, shared leadership or production changes. They are design references, not implemented controls or automatically authorized work.

## Official Hermes evidence and qualifications

Checked 2026-09-11 against official documentation and a narrow source inspection at commit `45a6101f36576367359c171cd5820ee76a3d047b`. This is not an execution test or complete implementation audit. The supplied article's impressions/business-success claim remains unverified.

### Profiles and Bot Mode — documented

Bots are profiles with separate configuration, skills, memory and sessions; Bot Mode provides a roster over that existing primitive. Profiles **do not sandbox filesystem access**. On the local backend the bot has the user's filesystem permissions; shared-vault edit restrictions in instructions are policy, not enforcement. Docs explicitly warn against two agent processes sharing one profile because automatic memory writes contaminate one another. Separate role memory plus deliberately shared accepted knowledge is consequently more than cosmetic organization.

Sources: [profiles](https://github.com/NousResearch/hermes-agent/blob/45a6101f36576367359c171cd5820ee76a3d047b/website/docs/user-guide/profiles.md), [Bot Mode](https://github.com/NousResearch/hermes-agent/blob/45a6101f36576367359c171cd5820ee76a3d047b/website/docs/user-guide/bot-mode.md).

### Work board — documented

Kanban is SQLite-backed, with separate worker processes, dependency gates, durable handoff summaries/metadata, comments, review, retries and human blocks. Agent tools and human CLI share board operations. Reviewer-requested changes return to the implementer; this is distinct from retrying infrastructure failure. Scratch workspaces disappear after completion: declared deliverables must be preserved as attachments. Named boards separate queues; tenant labels are softer filtering, not an OS sandbox.

Completion contracts are cataloged in HM-015. Their guarantees are completion-time observations, not continuous monitoring.

The orchestrator discovers actual profiles before delegation and stamps shared design decisions into every dependent card. Frontier planning plus cheaper profile workers and occasional per-task overrides is explicitly documented.

Source: [Kanban](https://github.com/NousResearch/hermes-agent/blob/45a6101f36576367359c171cd5820ee76a3d047b/website/docs/user-guide/features/kanban.md).

### Messaging and recovery — documented

DM queued acknowledgement means durable admission, not completed work. Unknown outcomes must not be blindly resent. Cross-machine hosted-room authority takeover requires fencing the old writer; timeout or disconnect is insufficient evidence. These reinforce separate conversation, work state and authority protocols.

Source: [Bot Mode](https://github.com/NousResearch/hermes-agent/blob/45a6101f36576367359c171cd5820ee76a3d047b/website/docs/user-guide/bot-mode.md).

### Narrow implementation confirmation

`complete_task` calls acceptance preparation before transition, rechecks dependencies inside its write transaction, persists acceptance, optionally checks the expected run ID, and records durable handoff data. This corroborates part of the documented completion boundary; the remote checker itself was not audited.

Source: [kanban_db.py:2529](https://github.com/NousResearch/hermes-agent/blob/45a6101f36576367359c171cd5820ee76a3d047b/hermes_cli/kanban_db.py#L2529).

### Release-date qualification

An [August 16 release exists](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.16), but the [August 31 Pantheon release](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.31) explicitly announces Bot Mode becoming bundled/default-on. Do not present the article's August 16 attribution as independently established by this check; current docs include later additions.
