import * as Schema from "effect/Schema";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  isPitbossLeadActive,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type PitbossAction,
  type PitbossCommand,
  type PitbossSnapshot,
} from "@t3tools/contracts";
import { decide, emptyWork, observeAttempt, workContext, type WorkActor } from "./Work.ts";
import { actionableInboxFor, activeLeads, inboxFor, leadView } from "./Leads.ts";
import { replayJournal } from "./WorkJournal.ts";

const isJson = Schema.is(Schema.Json);
const projectId = ProjectId.make("app");
const boss = ThreadId.make("glados");
const model = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-luna" };
function fixture() {
  let state: PitbossSnapshot = emptyWork;
  const journal: string[] = [];
  function run(action: PitbossAction, actor: WorkActor = { type: "user" }, generation?: number) {
    const input: PitbossCommand = {
      commandId: CommandId.make(`cmd-${state.revision}`),
      expectedRevision: state.revision,
      authorityGeneration:
        generation ??
        (actor.type === "agent"
          ? (activeLeads(state).find((lead) => lead.threadId === actor.threadId)?.generation ??
            state.role?.generation)
          : undefined),
      action,
    };
    state = decide(state, input, actor, "2026-09-11T00:00:00.000Z");
    journal.push(
      JSON.stringify({ type: "command", input, actor, now: "2026-09-11T00:00:00.000Z" }),
    );
    return state;
  }
  run({
    type: "elect",
    projectId,
    threadId: boss,
    brief: {
      priorities: "Small app",
      quality: "Run the combined app",
      projectIds: [projectId],
      maxWorkers: 2,
      maxAttempts: 2,
      workerModel: model,
    },
  });
  run(
    {
      type: "create-lead",
      leadId: "terra",
      projectId,
      charter: "Build and verify a small app; two Luna workers",
      model: { ...model, model: "gpt-5.6-terra" },
      maxWorkers: 2,
    },
    { type: "agent", threadId: boss },
  );
  const lead = state.leads![0]!;
  const actor: WorkActor = { type: "agent", threadId: lead.threadId };
  const task = (taskId: string, worktreePath?: string) =>
    run(
      {
        type: "create",
        taskId,
        projectId,
        title: taskId,
        outcome: "Working app",
        criteria: "Runs correctly",
        verifyCommand: "node --test",
        priority: 10,
        dependencies: [],
        workspaceStrategy: worktreePath
          ? { type: "existing_worktree", worktreePath }
          : { type: "worktree", baseRef: "HEAD" },
      },
      actor,
    );
  return {
    run,
    task,
    actor,
    lead,
    get state() {
      return state;
    },
    journal,
    stop(taskId: string) {
      const attempt = state.tasks.find((t) => t.id === taskId)!.attempts.at(-1)!;
      state = observeAttempt(state, taskId, attempt.id, "stopped", "Finished");
    },
  };
}

it("persists Terra project context and routes two Luna workers through its ownership", () => {
  const f = fixture();
  f.run(
    {
      type: "lead-context",
      leadId: "terra",
      context: "Decision: use localStorage key garden-v1. Verify persistence after reload.",
    },
    f.actor,
  );
  f.task("ui");
  f.task("storage");
  f.run({ type: "assign", taskId: "ui" }, f.actor);
  f.run({ type: "assign", taskId: "storage" }, f.actor);
  expect(f.state.tasks.map((t) => t.attempts[0]!.model.model)).toEqual([model.model, model.model]);
  expect(workContext(f.state, f.lead.threadId)).toContain(
    "Never implement or execute verification yourself",
  );
  const worker = f.state.tasks[0]!.attempts[0]!;
  expect(workContext(f.state, worker.threadId)).toContain("garden-v1");
  f.run(
    { type: "report", taskId: "ui", kind: "question", text: "Which empty state?" },
    { type: "agent", threadId: worker.threadId },
  );
  expect(inboxFor(f.state, "terra").at(-1)?.text).toBe("Which empty state?");
  expect(inboxFor(f.state).some((m) => m.text === "Which empty state?")).toBe(false);
  expect(replayJournal(f.journal)).toEqual(f.state);
  expect(leadView(f.state, f.lead.threadId)?.tasks).toHaveLength(2);
});

it("keeps legacy decision prompts in the audit inbox but out of manager actionability", () => {
  const f = fixture();
  f.task("decision");
  const legacy = {
    ...f.state,
    tasks: f.state.tasks.map((task) => ({
      ...task,
      decisions: [
        {
          id: "legacy-decision",
          question: "Choose a format?",
          options: ["A", "B"],
          recommendation: "A",
          requestedAt: "2026-09-11T00:00:00.000Z",
        },
      ],
    })),
    messages: [
      ...f.state.messages,
      {
        id: "legacy-decision",
        taskId: "decision",
        threadId: null,
        kind: "question" as const,
        text: "Decision needed: Choose a format?",
        createdAt: "2026-09-11T00:00:00.000Z",
        acknowledged: false,
      },
    ],
  };
  expect(inboxFor(legacy, f.lead.id).some((message) => message.id === "legacy-decision")).toBe(
    true,
  );
  expect(
    actionableInboxFor(legacy, f.lead.threadId, f.lead.id).some(
      (message) => message.id === "legacy-decision",
    ),
  ).toBe(false);
  expect(workContext(legacy, f.lead.threadId)).not.toContain("Choose a format?");
});

it("lets a lead coordinate only work already assigned to an approved remote task home", () => {
  const f = fixture();
  f.task("remote-ui");
  const coordinator = EnvironmentId.make("coordinator");
  const home = EnvironmentId.make("build-home");
  const shared = {
    ...f.state,
    sourceAuthorities: [
      {
        scope: "shared-ui",
        self: coordinator,
        coordinator,
        homeEnvironmentId: home,
        peerId: "build-peer",
        proposalId: "approved-proposal",
      },
    ],
    tasks: f.state.tasks.map((task) => ({
      ...task,
      source: {
        kind: "linear" as const,
        tenantId: "team",
        itemId: "issue-1",
        scope: "shared-ui",
        ownership: { viewerId: "lead-viewer", assigneeId: null, delegateId: null },
        key: "UI-1",
        url: "https://tracker.invalid/UI-1",
        status: "Open",
        priority: "1",
        observedAt: "2026-09-11T00:00:00.000Z",
      },
      homeEnvironmentId: home,
    })),
  };
  const manage = {
    commandId: CommandId.make("manage-remote"),
    expectedRevision: shared.revision,
    authorityGeneration: shared.role?.generation,
    action: { type: "manage-task" as const, taskId: "remote-ui", leadId: f.lead.id },
  };
  expect(() =>
    decide(
      { ...shared, sourceAuthorities: [] },
      manage,
      { type: "agent", threadId: boss },
      "2026-09-11T00:00:00.000Z",
    ),
  ).toThrow(/approved fixed-home authority/);
  expect(() =>
    decide(
      {
        ...shared,
        role: {
          ...shared.role!,
          brief: { ...shared.role!.brief, managedPeerIds: [] },
        },
      },
      manage,
      { type: "agent", threadId: boss },
      "2026-09-11T00:00:00.000Z",
    ),
  ).toThrow(/approved fixed-home authority/);
  const managed = decide(
    shared,
    manage,
    { type: "agent", threadId: boss },
    "2026-09-11T00:00:00.000Z",
  );
  const view = leadView(managed, f.lead.threadId)!;
  expect(view.tasks[0]?.homeEnvironmentId).toBe(home);
  expect(view.sourceAuthorities).toEqual(shared.sourceAuthorities);
  const downgraded = {
    ...managed,
    role: { ...managed.role!, brief: { ...managed.role!.brief, managedPeerIds: [] } },
  };
  expect(leadView(downgraded, f.lead.threadId)?.sourceAuthorities).toEqual([]);
  expect(() =>
    decide(
      downgraded,
      {
        commandId: CommandId.make("lead-after-peer-downgrade"),
        expectedRevision: downgraded.revision,
        authorityGeneration: downgraded.leads?.[0]?.generation,
        action: { type: "assign", taskId: "remote-ui" },
      },
      { type: "agent", threadId: f.lead.threadId },
      "2026-09-11T00:00:00.000Z",
    ),
  ).toThrow(/outside this lead's scope/);
  const queued = decide(
    managed,
    {
      commandId: CommandId.make("lead-remote-assign"),
      expectedRevision: managed.revision,
      authorityGeneration: managed.leads?.[0]?.generation,
      action: { type: "assign", taskId: "remote-ui" },
    },
    { type: "agent", threadId: f.lead.threadId },
    "2026-09-11T00:00:00.000Z",
  );
  expect(queued.tasks[0]?.pendingOperationId).toBe("lead-remote-assign");
  expect(queued.tasks[0]?.attempts).toEqual([]);
});

it("fences a dormant lead and preserves workers, context and question routing", () => {
  const f = fixture();
  f.task("ui");
  f.run({ type: "assign", taskId: "ui" }, f.actor);
  const before = f.state.tasks[0]!.attempts;
  f.run({ type: "lead-status", leadId: "terra", status: "dormant" });
  expect(f.state.tasks[0]!.attempts).toEqual(before);
  expect(() =>
    f.run({ type: "cancel", taskId: "ui", note: "stale" }, f.actor, f.lead.generation),
  ).toThrow(/current GLaDOS/);
  f.run({ type: "lead-status", leadId: "terra", status: "active" });
  expect(() =>
    f.run({ type: "cancel", taskId: "ui", note: "stale" }, f.actor, f.lead.generation),
  ).toThrow(/current GLaDOS/);
});

it("rejects recursive leadership, expanded scope, competing managers and unproved results", () => {
  const f = fixture();
  f.task("ui");
  expect(() =>
    f.run(
      { type: "create-lead", leadId: "nested", projectId, model, charter: "Extra", maxWorkers: 1 },
      f.actor,
    ),
  ).toThrow(/expand authority/);
  expect(() =>
    f.run(
      { type: "lead-report", leadId: "terra", kind: "result", text: "All done", taskIds: ["ui"] },
      f.actor,
    ),
  ).toThrow(/accepted tasks/);
  expect(() => f.run({ type: "assign", taskId: "ui" }, { type: "agent", threadId: boss })).toThrow(
    /Reclaim/,
  );
  f.run({ type: "manage-task", taskId: "ui", leadId: null }, { type: "agent", threadId: boss });
  expect(() => f.run({ type: "assign", taskId: "ui" }, f.actor)).toThrow(/outside this lead/);
});

it("shares worker capacity and rejects competing existing-workspace writers", () => {
  const f = fixture();
  f.task("one", "/tmp/lead-checkout");
  f.task("two", "/tmp/lead-checkout");
  f.run({ type: "assign", taskId: "one" }, f.actor);
  expect(() => f.run({ type: "assign", taskId: "two" }, f.actor)).toThrow(/owns that workspace/);
  f.task("three");
  f.run({ type: "assign", taskId: "three" }, f.actor);
  f.task("four");
  expect(() => f.run({ type: "assign", taskId: "four" }, f.actor)).toThrow(/capacity is full/);
});

it("requires stopped writers and current passing evidence before reporting accepted work", () => {
  const f = fixture();
  f.task("ui");
  f.run({ type: "assign", taskId: "ui" }, f.actor);
  const attempt = f.state.tasks[0]!.attempts[0]!;
  f.run(
    {
      type: "submit",
      taskId: "ui",
      attemptId: attempt.id,
      criteriaVersion: 1,
      candidate: "commit:abc",
      verdict: "pass",
      summary: "Ran test",
      command: "node --test",
      artifactUrls: [],
    },
    { type: "agent", threadId: attempt.threadId },
  );
  const evidenceId = f.state.tasks[0]!.evidence[0]!.id;
  expect(() =>
    f.run({ type: "accept", taskId: "ui", evidenceId, note: "Reviewed" }, f.actor),
  ).toThrow(/writer to stop/);
  f.stop("ui");
  f.run(
    { type: "accept", taskId: "ui", evidenceId, note: "Reviewed actual app and tests" },
    f.actor,
  );
  f.run(
    {
      type: "lead-report",
      leadId: "terra",
      taskIds: ["ui"],
      kind: "result",
      text: "App checked, evidence attached",
    },
    f.actor,
  );
  expect(inboxFor(f.state).at(-1)?.text).toContain(evidenceId);
  expect(inboxFor(f.state, "terra").some((m) => m.text.includes("App checked"))).toBe(false);
});

it("produces JSON-compatible manager snapshots for the MCP transport without configured peers", async () => {
  const { managerView } = await import("./Work.ts");
  const f = fixture();
  expect(isJson(managerView(f.state))).toBe(true);
});

it("allows a current worker submission across unrelated portfolio revisions but still fences its criteria", () => {
  const f = fixture();
  f.task("ui");
  f.run({ type: "assign", taskId: "ui" }, f.actor);
  const task = f.state.tasks[0]!;
  const attempt = task.attempts[0]!;
  const revision = f.state.revision;
  f.run(
    { type: "lead-context", leadId: "terra", context: "A separately observed project fact" },
    f.actor,
  );
  const command: PitbossCommand = {
    commandId: CommandId.make("worker-submission"),
    expectedRevision: revision,
    action: {
      type: "submit",
      taskId: task.id,
      attemptId: attempt.id,
      candidate: "commit:real",
      criteriaVersion: 1,
      verdict: "pass",
      summary: "Ran node test",
      command: "node --test",
      artifactUrls: [],
    },
  };
  const actor: WorkActor = { type: "agent", threadId: attempt.threadId };
  expect(decide(f.state, command, actor, "2026-09-11").tasks[0]!.status).toBe("verifying");
  expect(() =>
    decide(
      f.state,
      {
        ...command,
        action: {
          ...command.action,
          type: "submit",
          taskId: task.id,
          attemptId: attempt.id,
          candidate: "commit:real",
          criteriaVersion: 0,
          verdict: "pass",
          summary: "Wrong criteria",
          command: "node --test",
          artifactUrls: [],
        },
      },
      actor,
      "2026-09-11",
    ),
  ).toThrow(/criteria changed/);
});

it("lets the lead record its own review of a stopped candidate without impersonating the worker", () => {
  const f = fixture();
  f.task("ui");
  f.run({ type: "assign", taskId: "ui" }, f.actor);
  const attempt = f.state.tasks[0]!.attempts[0]!;
  const review: PitbossAction = {
    type: "review",
    taskId: "ui",
    attemptId: attempt.id,
    candidate: "commit:retained",
    criteriaVersion: 1,
    verdict: "pass",
    summary: "I ran the combined app and reload check",
    command: "node verify.mjs",
    artifactUrls: ["file:/tmp/proof.png"],
  };
  expect(() => f.run(review, f.actor)).toThrow(/Stop all writers/);
  f.stop("ui");
  f.run(review, f.actor);
  const evidence = f.state.tasks[0]!.evidence.at(-1)!;
  expect(evidence.provenance).toBe("coordinator_review");
  f.run(
    { type: "accept", taskId: "ui", evidenceId: evidence.id, note: "Combined behavior checked" },
    f.actor,
  );
  expect(f.state.tasks[0]!.status).toBe("done");
});

it("routes GLaDOS instructions durably to the lead and rejects a worker impersonating it", () => {
  const f = fixture();
  f.task("ui");
  f.run({ type: "assign", taskId: "ui" }, f.actor);
  const action: PitbossAction = {
    type: "lead-message",
    leadId: "terra",
    text: "Prioritize the persistence check",
  };
  f.run(action, { type: "agent", threadId: boss });
  expect(inboxFor(f.state, "terra").at(-1)?.text).toBe("Prioritize the persistence check");
  expect(() =>
    f.run(action, { type: "agent", threadId: f.state.tasks[0]!.attempts[0]!.threadId }),
  ).toThrow(/current GLaDOS/);
});

it("moving a task to another project revokes the previous lead's reads and writes", () => {
  const f = fixture();
  const other = ProjectId.make("other");
  f.run({ type: "brief", brief: { ...f.state.role!.brief, projectIds: [projectId, other] } });
  f.run({ type: "lead-status", leadId: f.lead.id, status: "active" });
  f.task("move");
  f.run({
    type: "edit",
    taskId: "move",
    projectId: other,
    title: "Moved",
    outcome: "Working app",
    criteria: "Runs correctly",
    verifyCommand: "node --test",
    priority: 10,
    dependencies: [],
    workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
  });
  expect(f.state.tasks[0]!.leadId).toBeUndefined();
  expect(leadView(f.state, f.actor.threadId)?.tasks).toEqual([]);
  expect(() => f.run({ type: "assign", taskId: "move" }, f.actor)).toThrow(
    "outside this lead's scope",
  );
});

it("effective lead status includes current project scope on all clients", () => {
  const f = fixture();
  expect(isPitbossLeadActive(f.state.role, f.lead)).toBe(true);
  const role = { ...f.state.role!, brief: { ...f.state.role!.brief, projectIds: [] } };
  expect(isPitbossLeadActive(role, f.lead)).toBe(false);
  expect(activeLeads({ ...f.state, role })).toEqual([]);
});
