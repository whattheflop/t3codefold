import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  PitbossError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  PitbossCommand,
  type PitbossSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import { WorkStore } from "../../../pitboss/WorkStore.ts";
import { McpInvocationContext, type McpInvocationScope } from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadsLayer } from "../../McpToolAccess.testkit.ts";
import { OrchestratorMcpService } from "../../OrchestratorMcpService.ts";
import { ThreadMetadataMcpService } from "../../ThreadMetadataMcpService.ts";
import * as OrchestratorHandlers from "../orchestrator/handlers.ts";
import { OrchestratorToolkit } from "../orchestrator/tools.ts";
import * as WorkHandlers from "./handlers.ts";
import { requireLedgerDelegation } from "./ledgerGuard.ts";
import { WorkToolkit } from "./tools.ts";

const encodeCommand = Schema.encodeSync(Schema.toCodecJson(PitbossCommand));
const projectId = ProjectId.make("project");
const providerInstanceId = ProviderInstanceId.make("codex");
const gladosThreadId = ThreadId.make("glados-thread");
const leadThreadId = ThreadId.make("lead-thread");
const workerThreadId = ThreadId.make("worker-thread");

const board: PitbossSnapshot = {
  revision: 3,
  role: {
    threadId: gladosThreadId,
    projectId,
    generation: 1,
    paused: false,
    brief: {
      priorities: "Ship",
      quality: "Prove behavior",
      projectIds: [projectId],
      maxWorkers: 1,
      maxAttempts: 1,
      workerModel: { instanceId: providerInstanceId, model: "gpt-5" },
    },
  },
  leads: [
    {
      id: "lead",
      threadId: leadThreadId,
      projectId,
      generation: 1,
      parentGeneration: 1,
      status: "active",
      charter: "Own the project",
      model: { instanceId: providerInstanceId, model: "gpt-5" },
      maxWorkers: 1,
      context: "",
      contextRevision: 0,
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  ],
  tasks: [],
  messages: [],
};

const threadScope = (threadId: ThreadId): McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment"),
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
  requestNamespace: `session:${threadId}`,
  thread: { threadId, providerSessionId: "session", providerInstanceId },
  client: undefined,
});
const clientScope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment"),
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
  requestNamespace: "client:session",
  thread: undefined,
  client: { sessionId: "session", label: "Claude Code", access: "full-access" },
};

const callerShell = (threadId: ThreadId, runtimeMode: OrchestrationV2ThreadShell["runtimeMode"]) =>
  ({
    id: threadId,
    projectId,
    providerInstanceId,
    runtimeMode,
    interactionMode: "default",
    activeRunId: "run",
    archivedAt: null,
    deletedAt: null,
  }) as OrchestrationV2ThreadShell;

const refusal = <A, E extends { readonly message: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.match({ onFailure: (error) => error.message, onSuccess: () => "allowed" }));

describe("requireLedgerDelegation", () => {
  const guard = (scope: McpInvocationScope, store?: Partial<WorkStore["Service"]>) =>
    refusal(requireLedgerDelegation("delegate_task")).pipe(
      Effect.provideService(McpInvocationContext, scope),
      Effect.provide(store === undefined ? Layer.empty : Layer.mock(WorkStore)(store)),
    );
  const read = () => Effect.succeed(board);

  it.effect("refuses GLaDOS and active project leads, and leaves other threads alone", () =>
    Effect.gen(function* () {
      assert.match(yield* guard(threadScope(gladosThreadId), { read }), /not available to GLaDOS/);
      assert.match(
        yield* guard(threadScope(leadThreadId), { read }),
        /not available to a project lead/,
      );
      assert.equal(yield* guard(threadScope(workerThreadId), { read }), "allowed");
    }),
  );

  it.effect("never reads the ledger for client callers and fails open without it", () =>
    Effect.gen(function* () {
      assert.equal(
        yield* guard(clientScope, { read: () => Effect.die("must not read") }),
        "allowed",
      );
      const unavailable = () =>
        Effect.fail(
          new PitbossError({ code: "unavailable", message: "Work storage unavailable." }),
        );
      assert.equal(yield* guard(threadScope(gladosThreadId), { read: unavailable }), "allowed");
      assert.equal(yield* guard(threadScope(gladosThreadId)), "allowed");
    }),
  );

  it.effect("guards delegate_task and create_threads before the orchestrator runs", () =>
    Effect.gen(function* () {
      const dependencies = Layer.mergeAll(
        Layer.succeed(McpInvocationContext, threadScope(gladosThreadId)),
        liveThreadsLayer,
        Layer.mock(WorkStore)({ read }),
        Layer.mock(OrchestratorMcpService)({
          delegateTask: () => Effect.die("must not delegate"),
          createThreads: () => Effect.die("must not create"),
        }),
        Layer.mock(ThreadMetadataMcpService)({}),
      );
      const built = yield* OrchestratorToolkit.pipe(
        Effect.provide(McpToolAccess.HandlersLayer.layer(OrchestratorHandlers.layer)),
      );
      const failureMessage = <A extends { readonly isFailure: boolean; readonly result: unknown }>(
        option: Option.Option<A>,
      ) =>
        Option.isSome(option) && option.value.isFailure
          ? String((option.value.result as { readonly message?: unknown }).message)
          : "allowed";
      const delegated = yield* built
        .handle("delegate_task", { task: "Do bounded work" })
        .pipe(Stream.unwrap, Stream.runLast, Effect.provide(dependencies));
      assert.match(failureMessage(delegated), /work_command/);
      const created = yield* built
        .handle("create_threads", { threads: [{ prompt: "Do bounded work" }] })
        .pipe(Stream.unwrap, Stream.runLast, Effect.provide(dependencies));
      assert.match(failureMessage(created), /work_command/);
    }),
  );
});

describe("work tools", () => {
  const harness = (scope: McpInvocationScope, runtimeMode: "approval-required" | "full-access") => {
    const commands: Array<Parameters<WorkStore["Service"]["command"]>> = [];
    const reads: Array<Parameters<WorkStore["Service"]["read"]>> = [];
    const dependencies = Layer.mergeAll(
      Layer.succeed(McpInvocationContext, scope),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (threadId) => Effect.succeed(callerShell(threadId, runtimeMode)),
      }),
      Layer.mock(WorkStore)({
        read: (...args) => Effect.sync(() => (reads.push(args), board)),
        command: (...args) => Effect.sync(() => (commands.push(args), board)),
      }),
    );
    const toolkit = WorkToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(WorkHandlers.layer).pipe(Layer.provide(dependencies)),
      ),
    );
    const read = toolkit.pipe(
      Effect.flatMap((built) => built.handle("work_read", {})),
      Stream.unwrap,
      Stream.runLast,
      Effect.provide(dependencies),
    );
    const command = (input: PitbossCommand) =>
      toolkit.pipe(
        Effect.flatMap((built) => built.handle("work_command", encodeCommand(input))),
        Stream.unwrap,
        Stream.runLast,
        Effect.provide(dependencies),
      );
    return { commands, reads, read, command };
  };

  it.effect("acts as the calling thread and refuses MCP clients from outside T3", () =>
    Effect.gen(function* () {
      const agent = harness(threadScope(workerThreadId), "approval-required");
      yield* agent.read;
      assert.deepEqual(agent.reads, [[{ type: "agent", threadId: workerThreadId }]]);

      const client = harness(clientScope, "full-access");
      const refused = yield* client.read;
      assert.isTrue(refused._tag === "Some" && refused.value.isFailure);
      assert.deepInclude(refused._tag === "Some" ? refused.value.result : undefined, {
        code: "thread_credential_required",
      });
      assert.deepEqual(client.reads, []);
    }),
  );

  it.effect("passes the caller's runtime mode only to commands that launch agents", () =>
    Effect.gen(function* () {
      const { commands, command } = harness(threadScope(gladosThreadId), "full-access");
      yield* command({
        commandId: CommandId.make("create-lead"),
        expectedRevision: 3,
        action: {
          type: "create-lead",
          leadId: "lead-2",
          projectId,
          charter: "Own the project",
          model: { instanceId: providerInstanceId, model: "gpt-5" },
          maxWorkers: 1,
          runtimeMode: "full-access",
        },
      });
      yield* command({
        commandId: CommandId.make("pause"),
        expectedRevision: 3,
        action: { type: "pause", paused: true },
      });
      assert.deepEqual(
        commands.map(([, actor, authority]) => [actor, authority]),
        [
          [{ type: "agent", threadId: gladosThreadId }, { runtimeMode: "full-access" }],
          [{ type: "agent", threadId: gladosThreadId }, undefined],
        ],
      );
    }),
  );
});
