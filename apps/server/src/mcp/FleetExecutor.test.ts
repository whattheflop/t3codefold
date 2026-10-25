import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  type ExecutionEnvironmentDescriptor,
  type FleetExecuteInput,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as Project from "../project/ProjectService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { FleetExecutor, layer } from "./FleetExecutor.ts";
import { FleetRouter, type FleetRemoteRequest } from "./FleetRouter.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import { OrchestratorMcpService } from "./OrchestratorMcpService.ts";

const localId = EnvironmentId.make("server");
const sourceId = EnvironmentId.make("laptop");
const projectId = ProjectId.make("project");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };

// The results are `unknown`, so flipping them would put `unknown` in the error channel.
const failureOf = <E>(effect: Effect.Effect<unknown, E>) => Effect.flip(Effect.asVoid(effect));

function fixture() {
  const scopes: Array<McpInvocationScope> = [];
  const launched: Array<ThreadLaunch.ThreadLaunchInput> = [];
  const routed: Array<[unknown, FleetRemoteRequest]> = [];
  const dependencies = Layer.mergeAll(
    NodeCrypto.layer,
    NodeServices.layer,
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-fleet-executor-" }).pipe(
      Layer.provide(NodeServices.layer),
    ),
    Layer.succeed(ServerEnvironment, {
      getEnvironmentId: Effect.succeed(localId),
      getDescriptor: Effect.succeed({
        environmentId: localId,
        label: "Home server",
        platform: { os: "linux", arch: "x64" },
        serverVersion: "test",
        capabilities: { repositoryIdentity: true },
      } satisfies ExecutionEnvironmentDescriptor),
    }),
    Layer.mock(OrchestratorMcpService)({
      listThreads: (scope, input) =>
        Effect.sync(() => {
          scopes.push(scope);
          return {
            projectId: input.projectId ?? projectId,
            currentThreadId: null,
            threads: [],
            nextCursor: null,
            total: 0,
          };
        }),
    }),
    Layer.mock(FleetRouter)({
      invoke: (caller, request) =>
        Effect.sync(() => {
          routed.push([caller, request]);
          return { routed: "remote" };
        }),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({}),
    Layer.mock(ThreadLaunch.ThreadLaunchService)({
      launch: (input) =>
        Effect.sync(() => {
          launched.push(input);
          return {
            threadId: input.threadId,
            projection: {
              thread: { id: input.threadId, projectId: input.projectId, modelSelection },
              runs: [],
            },
            resumed: false,
          } as unknown as ThreadLaunch.ThreadLaunchResult;
        }),
    }),
    Layer.mock(Project.ProjectService)({}),
    Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({ namedProjectsRoot: "/projects" }),
    Layer.mock(GitVcsDriver.GitVcsDriver)({}),
    ServerSettings.layerTest(),
  );
  return { scopes, launched, routed, layer: layer.pipe(Layer.provideMerge(dependencies)) };
}

const fromAgent = (
  request: Pick<FleetExecuteInput, "operation" | "input"> & Partial<FleetExecuteInput>,
): FleetExecuteInput => ({
  source: {
    environmentId: sourceId,
    threadId: ThreadId.make("source-thread"),
    runtimeMode: "approval-required",
    interactionMode: "default",
  },
  environmentId: localId,
  ...request,
});

it.effect("runs a relayed request as a client caller keyed by its source", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const executor = yield* FleetExecutor;
    const result = yield* executor.execute(
      fromAgent({ operation: "t3_thread_list", input: { projectId } }),
    );
    expect(result).toMatchObject({ environmentId: localId, projectId, total: 0 });
    expect(f.scopes).toHaveLength(1);
    expect(f.scopes[0]).toMatchObject({
      environmentId: localId,
      thread: undefined,
      requestNamespace: "fleet:laptop:source-thread",
      client: {
        sessionId: "fleet:laptop:source-thread",
        label: "fleet",
        access: "approval-required",
      },
    });
    expect([...(f.scopes[0]?.capabilities ?? [])]).toEqual(["orchestration"]);
  }).pipe(Effect.provide(f.layer));
});

it.effect("refuses a request addressed to another environment", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const executor = yield* FleetExecutor;
    const result = yield* failureOf(
      executor.execute(
        fromAgent({ environmentId: sourceId, operation: "t3_thread_list", input: {} }),
      ),
    );
    expect(result.code).toBe("invalid_request");
    expect(f.scopes).toEqual([]);
  }).pipe(Effect.provide(f.layer));
});

it.effect("moves an older source's top-level projectId into the tool input", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const executor = yield* FleetExecutor;
    const other = ProjectId.make("other-project");
    const moved = yield* executor.execute(
      fromAgent({ projectId: other, operation: "t3_thread_list", input: {} }),
    );
    expect(moved).toMatchObject({ projectId: other });
    const result = yield* executor.execute(
      fromAgent({ projectId: other, operation: "t3_thread_list", input: { projectId } }),
    );
    expect(result).toMatchObject({ projectId });
    expect(f.scopes).toHaveLength(2);
  }).pipe(Effect.provide(f.layer));
});

it.effect("launches through t3_thread_launch, capped by the source's modes", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const executor = yield* FleetExecutor;
    const source = {
      environmentId: sourceId,
      threadId: ThreadId.make("source-thread"),
      runtimeMode: "approval-required" as const,
      interactionMode: "plan" as const,
    };
    const result = yield* executor.execute({
      source,
      environmentId: localId,
      operation: "t3_thread_launch",
      input: { projectId, title: "Audit", message: "Review it", modelSelection },
    });
    expect(result).toMatchObject({ environmentId: localId, projectId, modelSelection });
    expect(f.launched).toHaveLength(1);
    expect(f.launched[0]).toMatchObject({
      projectId,
      title: "Audit",
      modelSelection,
      runtimeMode: "approval-required",
      interactionMode: "plan",
      createdBy: "agent",
      creationSource: "mcp",
      initialMessage: { text: "Review it" },
    });
    expect(f.launched[0]?.initialMessage?.senderThreadId).toBeUndefined();

    const escalated = yield* failureOf(
      executor.execute({
        source,
        environmentId: localId,
        operation: "t3_thread_launch",
        input: { projectId, title: "Audit", modelSelection, runtimeMode: "full-access" },
      }),
    );
    expect(escalated.code).toBe("runtime_mode_escalation_denied");
    const broadened = yield* failureOf(
      executor.execute({
        source,
        environmentId: localId,
        operation: "t3_thread_launch",
        input: { projectId, title: "Audit", modelSelection, interactionMode: "default" },
      }),
    );
    expect(broadened.code).toBe("interaction_mode_escalation_denied");
    expect(f.launched).toHaveLength(1);
  }).pipe(Effect.provide(f.layer));
});

it.effect("serves an older source's t3_thread_start as a launch", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const executor = yield* FleetExecutor;
    yield* executor.execute(
      fromAgent({
        projectId,
        operation: "t3_thread_start",
        input: {
          prompt: "Continue the handoff",
          target: { providerInstanceId: "codex", model: "gpt-5" },
          clientRequestId: "stable",
        },
      }),
    );
    expect(f.launched[0]).toMatchObject({
      projectId,
      title: "New thread",
      modelSelection,
      initialMessage: { text: "Continue the handoff" },
    });
    const partial = yield* failureOf(
      executor.execute(
        fromAgent({
          projectId,
          operation: "t3_thread_start",
          input: { prompt: "Continue", target: { model: "gpt-5" } },
        }),
      ),
    );
    expect(partial.code).toBe("invalid_request");
    expect(f.launched).toHaveLength(1);
  }).pipe(Effect.provide(f.layer));
});

it.effect("runs CLI requests locally with full access and routes others", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const executor = yield* FleetExecutor;
    yield* executor.invoke({ operation: "t3_thread_list", input: { projectId } });
    expect(f.scopes[0]).toMatchObject({
      requestNamespace: "fleet:server:cli",
      client: { access: "full-access" },
    });
    expect(f.routed).toEqual([]);

    const remote = yield* executor.invoke({
      environmentId: sourceId,
      operation: "t3_thread_read",
      input: { threadId: "thread" },
    });
    expect(remote).toEqual({ routed: "remote" });
    expect(f.routed).toEqual([
      [
        undefined,
        {
          environmentId: sourceId,
          operation: "t3_thread_read",
          input: { threadId: "thread" },
        },
      ],
    ]);
    expect(f.scopes).toHaveLength(1);
  }).pipe(Effect.provide(f.layer));
});
