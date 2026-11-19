import {
  type FleetExecuteInput,
  type FleetInvokeInput,
  OrchestratorMcpCapabilitiesResult,
  OrchestratorMcpFailure,
  OrchestratorMcpThreadListInput,
  OrchestratorMcpThreadListResult,
  OrchestratorMcpThreadReadInput,
  OrchestratorMcpThreadReadResult,
  OrchestratorMcpThreadSendInput,
  OrchestratorMcpThreadSendResult,
  OrchestratorMcpThreadStartInput,
  OrchestratorMcpThreadWaitInput,
  OrchestratorMcpThreadWaitResult,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { Tool, Toolkit } from "effect/ai";

import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { FleetRouter } from "./FleetRouter.ts";
import { McpInvocationContext, type McpInvocationScope } from "./McpInvocationContext.ts";
import * as McpToolAccess from "./McpToolAccess.ts";
import { resolveInteractionMode } from "./delegatedTaskModes.ts";
import { OrchestratorMcpService } from "./OrchestratorMcpService.ts";
import * as ProjectHandlers from "./toolkits/project/handlers.ts";
import { ProjectToolkit } from "./toolkits/project/tools.ts";

type ProjectTools = Toolkit.Tools<typeof ProjectToolkit>;
/** What the project tools need per call, minus the caller scope the executor supplies. */
type ProjectToolServices = Exclude<
  Tool.HandlerServices<ProjectTools["t3_thread_launch"] | ProjectTools["t3_project_list"]>,
  McpInvocationContext
>;

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });
const orchestrationFailure = (message: string) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message });
const isOrchestratorMcpFailure = Schema.is(OrchestratorMcpFailure);

const decodeInput =
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  (input: unknown) =>
    Schema.decodeUnknownEffect(schema)(input).pipe(
      Effect.mapError((error) => invalid(error.message)),
    );
const encodeResult =
  <S extends Schema.Encoder<unknown>>(schema: S) =>
  (value: S["Type"]) =>
    Schema.encodeEffect(schema)(value).pipe(
      Effect.mapError((error) => orchestrationFailure(error.message)),
    );

const decodeLaunchParams = decodeInput(
  Schema.toCodecJson(ProjectToolkit.tools.t3_thread_launch.parametersSchema),
);
const encodeLaunchParams = encodeResult(
  Schema.toCodecJson(ProjectToolkit.tools.t3_thread_launch.parametersSchema),
);
const decodeProjectListParams = decodeInput(
  Schema.toCodecJson(ProjectToolkit.tools.t3_project_list.parametersSchema),
);
const encodeProjectListParams = encodeResult(
  Schema.toCodecJson(ProjectToolkit.tools.t3_project_list.parametersSchema),
);
const decodeThreadStart = decodeInput(OrchestratorMcpThreadStartInput);
const decodeThreadList = decodeInput(OrchestratorMcpThreadListInput);
const decodeThreadRead = decodeInput(OrchestratorMcpThreadReadInput);
const decodeThreadSend = decodeInput(OrchestratorMcpThreadSendInput);
const decodeThreadWait = decodeInput(OrchestratorMcpThreadWaitInput);
const encodeCapabilities = encodeResult(OrchestratorMcpCapabilitiesResult);
const encodeThreadList = encodeResult(OrchestratorMcpThreadListResult);
const encodeThreadRead = encodeResult(OrchestratorMcpThreadReadResult);
const encodeThreadSend = encodeResult(OrchestratorMcpThreadSendResult);
const encodeThreadWait = encodeResult(OrchestratorMcpThreadWaitResult);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Older Fold sources sent the destination project beside the tool input; the
 * tool input is now the only place it lives.
 */
const toolInput = (request: FleetExecuteInput): unknown =>
  request.projectId !== undefined &&
  isRecord(request.input) &&
  request.input.projectId === undefined
    ? { ...request.input, projectId: request.projectId }
    : request.input;

/**
 * Maps the `t3_thread_start` shape onto `t3_thread_launch` parameters. Only a
 * fully named target (provider instance plus model) translates to a model
 * selection; anything else needs t3_thread_launch's modelSelection.
 */
export const threadStartAsLaunch = Effect.fn("threadStartAsLaunch")(function* (
  input: OrchestratorMcpThreadStartInput,
) {
  const target = input.target;
  if (
    target !== undefined &&
    (target.driverKind !== undefined ||
      target.options !== undefined ||
      (target.providerInstanceId === undefined) !== (target.model === undefined))
  )
    return yield* invalid(
      "t3_thread_start accepts only target.providerInstanceId with target.model. Use t3_thread_launch with modelSelection for other targets.",
    );
  return {
    ...(input.environmentId === undefined ? {} : { environmentId: input.environmentId }),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    title: input.title ?? "New thread",
    message: input.prompt,
    ...(target?.providerInstanceId !== undefined && target.model !== undefined
      ? { modelSelection: { instanceId: target.providerInstanceId, model: target.model } }
      : {}),
    ...(input.runtimeMode === undefined || input.runtimeMode === "inherit"
      ? {}
      : { runtimeMode: input.runtimeMode }),
    ...(input.interactionMode === undefined || input.interactionMode === "inherit"
      ? {}
      : { interactionMode: input.interactionMode }),
    ...(input.clientRequestId === undefined ? {} : { clientRequestId: input.clientRequestId }),
  };
});

/**
 * Runs fleet requests on this (the destination) environment. A request runs
 * as a synthetic MCP client caller keyed by its source, so UP's caller limits
 * and requestNamespace-scoped retry keys apply unchanged: the source thread's
 * runtime mode is the ceiling, and the admin CLI gets full access.
 */
export class FleetExecutor extends Context.Service<
  FleetExecutor,
  {
    /** Runs a request a client relayed to this environment. */
    readonly execute: (
      request: FleetExecuteInput,
    ) => Effect.Effect<unknown, OrchestratorMcpFailure>;
    /** The `t3 fleet` CLI entry: runs locally or routes to the selected environment. */
    readonly invoke: (input: FleetInvokeInput) => Effect.Effect<unknown, OrchestratorMcpFailure>;
  }
>()("t3/mcp/FleetExecutor") {}

const make = Effect.gen(function* () {
  const environment = yield* ServerEnvironment;
  const orchestrator = yield* OrchestratorMcpService;
  const router = yield* FleetRouter;
  const projectTools = yield* ProjectToolkit.pipe(
    Effect.provide(McpToolAccess.HandlersLayer.layer(ProjectHandlers.layer)),
  );
  const projectToolServices = yield* Effect.context<ProjectToolServices>();
  const localId = yield* environment.getEnvironmentId;

  const callerScope = Effect.fn("FleetExecutor.callerScope")(function* (
    source: FleetExecuteInput["source"],
  ) {
    const key = `fleet:${source.environmentId}:${source.threadId ?? "cli"}`;
    return {
      environmentId: localId,
      capabilities: new Set(["orchestration" as const]),
      issuedAt: yield* Clock.currentTimeMillis,
      requestNamespace: key,
      thread: undefined,
      client: {
        sessionId: key,
        label: "fleet",
        access: source.runtimeMode ?? "full-access",
      },
    } satisfies McpInvocationScope;
  });

  /** Runs a project tool's own handler and returns its encoded success. */
  const runProjectTool = <
    Result extends {
      readonly isFailure: boolean;
      readonly result: unknown;
      readonly encodedResult: unknown;
    },
    E extends { readonly message: string },
  >(
    scope: McpInvocationScope,
    handled: Effect.Effect<
      Stream.Stream<Result, E, ProjectToolServices | McpInvocationContext>,
      E,
      ProjectToolServices | McpInvocationContext
    >,
  ) =>
    handled.pipe(
      Stream.unwrap,
      Stream.runLast,
      Effect.provideService(McpInvocationContext, scope),
      Effect.provideContext(projectToolServices),
      Effect.mapError((error) => invalid(error.message)),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(orchestrationFailure("The tool returned no result.")),
          onSome: (output) =>
            output.isFailure
              ? Effect.fail(
                  isOrchestratorMcpFailure(output.result)
                    ? output.result
                    : orchestrationFailure("The tool failed."),
                )
              : Effect.succeed(output.encodedResult),
        }),
      ),
    );

  const launch = Effect.fn("FleetExecutor.launch")(function* (
    request: FleetExecuteInput,
    scope: McpInvocationScope,
    input: unknown,
  ) {
    const params = yield* decodeLaunchParams(input);
    // A client caller has no interaction ceiling of its own, so the source's applies here.
    const interactionMode =
      request.source.interactionMode === undefined
        ? params.interactionMode
        : yield* resolveInteractionMode(request.source.interactionMode, params.interactionMode);
    const result = yield* runProjectTool(
      scope,
      projectTools.handle(
        "t3_thread_launch",
        yield* encodeLaunchParams({
          ...params,
          ...(interactionMode === undefined ? {} : { interactionMode }),
        }),
      ),
    );
    return isRecord(result) ? { ...result, environmentId: localId } : result;
  });

  const execute = Effect.fn("FleetExecutor.execute")(function* (request: FleetExecuteInput) {
    if (request.environmentId !== localId)
      return yield* invalid("The request destination does not match this environment.");
    const scope = yield* callerScope(request.source);
    const input = toolInput(request);
    switch (request.operation) {
      case "orchestrator_capabilities":
        return yield* encodeCapabilities({
          ...(yield* orchestrator.capabilities(scope)),
          environmentId: localId,
        });
      case "t3_project_list": {
        const params = yield* decodeProjectListParams(input);
        const result = yield* runProjectTool(
          scope,
          projectTools.handle("t3_project_list", yield* encodeProjectListParams(params)),
        );
        return isRecord(result) ? { ...result, environmentId: localId } : result;
      }
      case "t3_thread_launch":
        return yield* launch(request, scope, input);
      case "t3_thread_start":
        return yield* launch(
          request,
          scope,
          yield* threadStartAsLaunch(yield* decodeThreadStart(input)),
        );
      case "t3_thread_list":
        return yield* encodeThreadList({
          ...(yield* orchestrator.listThreads(scope, yield* decodeThreadList(input))),
          environmentId: localId,
        });
      case "t3_thread_read":
        return yield* encodeThreadRead({
          ...(yield* orchestrator.readThread(scope, yield* decodeThreadRead(input))),
          environmentId: localId,
        });
      case "t3_thread_send":
        return yield* encodeThreadSend({
          ...(yield* orchestrator.sendToThread(scope, yield* decodeThreadSend(input))),
          environmentId: localId,
        });
      case "t3_thread_wait":
        return yield* encodeThreadWait({
          ...(yield* orchestrator.waitForThread(scope, yield* decodeThreadWait(input))),
          environmentId: localId,
        });
    }
  });

  const invoke = Effect.fn("FleetExecutor.invoke")(function* (input: FleetInvokeInput) {
    const environmentId = input.environmentId ?? localId;
    if (environmentId !== localId)
      return yield* router.invoke(undefined, { ...input, environmentId });
    return yield* execute({
      ...input,
      environmentId,
      source: { environmentId: localId, threadId: null },
    });
  });

  return FleetExecutor.of({ execute, invoke });
});

export const layer = Layer.effect(FleetExecutor, make);
