import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { Tool, Toolkit } from "effect/ai";

import * as ServerConfig from "../../../config.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../../../project/ManagedProjectFolders.ts";
import * as Project from "../../../project/ProjectService.ts";
import { FleetRouter, type FleetCaller, type FleetRemoteRequest } from "../../FleetRouter.ts";
import * as GitVcsDriver from "../../../vcs/GitVcsDriver.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { OrchestratorMcpService } from "../../OrchestratorMcpService.ts";
import { ThreadMetadataMcpService } from "../../ThreadMetadataMcpService.ts";
import { layer as handlersLayer } from "./handlers.ts";
import { OrchestratorToolkit } from "./tools.ts";

type Tools = Toolkit.Tools<typeof OrchestratorToolkit>;

/** Calls a tool through its declared handler; fails with the tool's declared failure. */
const call = <Name extends keyof Tools & string>(
  name: Name,
  params: Tool.Parameters<Tools[Name]>,
) =>
  OrchestratorToolkit.pipe(
    Effect.provide(McpToolAccess.HandlersLayer.layer(handlersLayer)),
    Effect.flatMap((built) => built.handle(name, params)),
    Stream.unwrap,
    Stream.runLast,
    Effect.orDie,
    Effect.flatMap((output) =>
      Option.isNone(output)
        ? Effect.die("no result")
        : output.value.isFailure
          ? Effect.fail(output.value.result as Tool.Failure<Tools[Name]>)
          : Effect.succeed(output.value.result as Tool.Success<Tools[Name]>),
    ),
  );

const environmentId = EnvironmentId.make("source");
const remote = EnvironmentId.make("destination");
const threadId = ThreadId.make("source-thread");
const providerInstanceId = ProviderInstanceId.make("codex");
const remoteProjectId = ProjectId.make("destination-project");

/** A thread caller on `environmentId` whose fleet requests land in `routed`. */
const setup = (remoteResult: unknown) => {
  const routed: Array<[FleetCaller | undefined, FleetRemoteRequest]> = [];
  const layer = Layer.mergeAll(
    NodeCrypto.layer,
    NodeServices.layer,
    ServerSettings.layerTest(),
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-fleet-routing-" }).pipe(
      Layer.provide(NodeServices.layer),
    ),
    Layer.succeed(McpInvocationContext, {
      environmentId,
      capabilities: new Set(["orchestration" as const]),
      issuedAt: 0,
      requestNamespace: "source-session",
      thread: { threadId, providerSessionId: "source-session", providerInstanceId },
      client: undefined,
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: () =>
        Effect.succeed({
          id: threadId,
          projectId: ProjectId.make("local-project"),
          providerInstanceId,
          runtimeMode: "approval-required",
          interactionMode: "plan",
          activeRunId: "run",
          archivedAt: null,
          deletedAt: null,
        } as OrchestrationV2ThreadShell),
    }),
    Layer.mock(OrchestratorMcpService)({
      listThreads: () =>
        Effect.succeed({
          projectId: ProjectId.make("local-project"),
          currentThreadId: threadId,
          threads: [],
          nextCursor: null,
          total: 0,
        }),
      interruptThread: () => Effect.die("must not interrupt locally"),
    }),
    Layer.mock(FleetRouter)({
      invoke: (caller, request) =>
        Effect.sync(() => {
          routed.push([caller, request]);
          return remoteResult;
        }),
    }),
    Layer.mock(ThreadLaunch.ThreadLaunchService)({
      launch: () => Effect.die("must not launch locally"),
    }),
    Layer.mock(Project.ProjectService)({}),
    Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({ namedProjectsRoot: "/projects" }),
    Layer.mock(GitVcsDriver.GitVcsDriver)({}),
    Layer.mock(ThreadMetadataMcpService)({}),
  );
  return { routed, layer };
};

it.effect("routes the t3_thread_start alias as a launch with the source thread's limits", () => {
  const { routed, layer } = setup({
    environmentId: remote,
    threadId: ThreadId.make("created"),
    projectId: remoteProjectId,
    modelSelection: { instanceId: "destination-provider", model: "destination-model" },
    runId: null,
    status: null,
  });
  return Effect.gen(function* () {
    const result = yield* call("t3_thread_start", {
      environmentId: remote,
      projectId: remoteProjectId,
      prompt: "Continue from commit abc",
      clientRequestId: "retry",
      runtimeMode: "inherit",
    });
    assert.deepInclude(result, { environmentId: remote });
    assert.equal(routed.length, 1);
    const [caller, request] = routed[0]!;
    assert.deepEqual(caller?.limits, { runtimeMode: "approval-required", interactionMode: "plan" });
    assert.equal(request.operation, "t3_thread_launch");
    // Provider defaults stay destination-local: no modelSelection is invented here.
    assert.deepEqual(request.input, {
      environmentId: remote,
      projectId: remoteProjectId,
      title: "New thread",
      message: "Continue from commit abc",
      clientRequestId: "retry",
    });
  }).pipe(Effect.provide(layer));
});

it.effect("validates destination results and keeps local calls local", () => {
  const { routed, layer } = setup({ malformed: true });
  return Effect.gen(function* () {
    const invalid = yield* call("t3_thread_list", {
      environmentId: remote,
      projectId: remoteProjectId,
    }).pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "unexpected" }));
    assert.equal(invalid, "orchestration_error");
    assert.equal(routed.length, 1);

    const local = yield* call("t3_thread_list", { environmentId });
    assert.equal(local.projectId, "local-project");
    assert.equal(routed.length, 1);
  }).pipe(Effect.provide(layer));
});

it.effect("refuses to interrupt a thread named for another environment", () => {
  const { routed, layer } = setup({});
  return Effect.gen(function* () {
    const refused = yield* call("t3_thread_interrupt", {
      environmentId: remote,
      threadId: ThreadId.make("remote-thread"),
    }).pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "unexpected" }));
    assert.equal(refused, "invalid_request");
    assert.equal(routed.length, 0);
  }).pipe(Effect.provide(layer));
});
