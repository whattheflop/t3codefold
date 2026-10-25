import {
  AuthStandardClientScopes,
  ORCHESTRATION_PROTOCOL_VERSION,
  FleetEnvironmentList,
  NonNegativeInt,
  ProjectId,
  WsRpcGroup,
  WS_METHODS,
  type FleetInvokeInput,
  type FleetOperation,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Command, Flag, GlobalFlag } from "effect/cli";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { RpcClientError } from "effect/rpc/RpcClientError";
import * as Socket from "effect/socket/Socket";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { projectLocationFlags, resolveCliAuthConfig, type CliAuthLocationFlags } from "./config.ts";

export class FleetCliError extends Schema.TaggedError<FleetCliError>()("FleetCliError", {
  message: Schema.String,
}) {}

const decodeEnvironments = Schema.decodeUnknownEffect(FleetEnvironmentList);
const FleetProjectSelectorRow = Schema.Struct({
  id: ProjectId,
  title: Schema.String,
  workspaceRoot: Schema.String,
});
/** The page shape of `t3_project_list`, keeping only what selectors read. */
const FleetProjectPage = Schema.Struct({
  projects: Schema.Array(FleetProjectSelectorRow),
  nextCursor: Schema.NullOr(NonNegativeInt),
});
const decodeProjectPage = Schema.decodeUnknownEffect(FleetProjectPage);
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const isFleetCliError = Schema.is(FleetCliError);
const isRpcClientError = Schema.is(RpcClientError);

/** Select ids before labels: duplicate labels must never silently route to another machine. */
export function resolveFleetSelector<T>(
  items: ReadonlyArray<T>,
  selector: string,
  kind: string,
  id: (item: T) => string,
  labels: (item: T) => ReadonlyArray<string>,
): T {
  const exact = items.find((item) => id(item) === selector);
  if (exact) return exact;
  const matches = items.filter((item) => labels(item).includes(selector));
  if (matches.length === 1) return matches[0]!;
  throw new FleetCliError({
    message:
      matches.length > 1
        ? `Ambiguous ${kind} '${selector}'; use its id.`
        : `No connected ${kind} matches '${selector}'.`,
  });
}

export interface FleetCliRequest {
  readonly operation: FleetOperation;
  readonly environment?: string | undefined;
  readonly project?: string | undefined;
  readonly input: unknown;
}
export interface FleetCliClient {
  readonly environments: () => Effect.Effect<unknown, Error>;
  readonly invoke: (input: FleetInvokeInput) => Effect.Effect<unknown, Error>;
}

/** Resolve human selectors using the same live routing catalogue as the client. */
export const invokeFleetCommand = Effect.fn("invokeFleetCommand")(function* (
  client: FleetCliClient,
  request: FleetCliRequest,
) {
  const environments = yield* decodeEnvironments(yield* client.environments());
  const environment =
    request.environment === undefined
      ? undefined
      : yield* Effect.try({
          try: () =>
            resolveFleetSelector(
              environments.environments,
              request.environment!,
              "environment",
              (e) => e.environmentId,
              (e) => [e.label],
            ),
          catch: (cause) =>
            isFleetCliError(cause)
              ? cause
              : new FleetCliError({ message: "Cannot resolve environment." }),
        });
  const environmentId = environment?.environmentId;
  let projectId: ProjectId | undefined;
  if (request.project !== undefined) {
    const projects: Array<typeof FleetProjectSelectorRow.Type> = [];
    let cursor: number | null = 0;
    while (cursor !== null) {
      const page: typeof FleetProjectPage.Type = yield* decodeProjectPage(
        yield* client.invoke({
          environmentId,
          operation: "t3_project_list",
          input: { cursor, limit: 100 },
        }),
      );
      projects.push(...page.projects);
      cursor = page.nextCursor;
    }
    const project = yield* Effect.try({
      try: () =>
        resolveFleetSelector(
          projects,
          request.project!,
          "project",
          (p) => p.id,
          (p) => [p.title, p.workspaceRoot],
        ),
      catch: (cause) =>
        isFleetCliError(cause) ? cause : new FleetCliError({ message: "Cannot resolve project." }),
    });
    projectId = project.id;
  }
  // The project lives in the tool input, where t3_thread_launch and t3_thread_list read it.
  return yield* client.invoke({
    environmentId,
    operation: request.operation,
    input:
      projectId === undefined || typeof request.input !== "object" || request.input === null
        ? request.input
        : { ...request.input, projectId },
  });
});

const withLiveFleet = Effect.fn("withLiveFleet")(function* (
  flags: CliAuthLocationFlags,
  run: (client: FleetCliClient) => Effect.Effect<unknown, Error>,
) {
  const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel);
  const state = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
  if (Option.isNone(state))
    return yield* new FleetCliError({
      message: "No running T3 server found. Start T3 or select its --base-dir.",
    });
  const origin = state.value.origin;
  yield* Effect.gen(function* () {
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    return yield* Effect.acquireUseRelease(
      auth.issueSession({ scopes: AuthStandardClientScopes, label: "t3 fleet cli" }),
      (session) =>
        Effect.gen(function* () {
          const url = new URL("/ws", origin);
          url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
          const ticket = yield* auth.issueWebSocketTicket(session);
          url.searchParams.set("wsTicket", ticket.ticket);
          url.searchParams.set("orchestrationProtocol", String(ORCHESTRATION_PROTOCOL_VERSION));
          const socket = Socket.layerWebSocket(url.toString(), { openTimeout: "5 seconds" }).pipe(
            Layer.provide(NodeSocket.layerWebSocketConstructor),
          );
          const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
            Layer.provide(Layer.mergeAll(socket, RpcSerialization.layerJson)),
          );
          return yield* Effect.gen(function* () {
            const rpc = yield* RpcClient.make(WsRpcGroup);
            const result = yield* run({
              environments: () => rpc[WS_METHODS.fleetEnvironments]({}),
              invoke: (input) => rpc[WS_METHODS.fleetInvoke](input),
            });
            yield* Console.log(yield* encodeJson(result));
          }).pipe(
            Effect.provide(protocol),
            Effect.scoped,
            Effect.catchIf(
              isRpcClientError,
              () =>
                new FleetCliError({
                  message:
                    "Cannot reach the running T3 server. Check that it is online and --base-dir selects the right instance.",
                }),
            ),
          );
        }),
      (session) => auth.revokeSession(session.sessionId).pipe(Effect.ignore({ log: true })),
    );
  }).pipe(
    Effect.provide(EnvironmentAuth.layerRuntime.pipe(Layer.provide(ServerConfig.layer(config)))),
  );
});

const definedFields = (input: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));

const optionalText = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withDescription(description), Flag.optional);
const selectors = {
  ...projectLocationFlags,
  environment: optionalText(
    "environment",
    "Connected environment id or unique label; defaults to this server.",
  ),
  project: optionalText(
    "project",
    "Project id, unique title, or workspace path on the selected environment.",
  ),
};
const promptFlags = {
  prompt: optionalText("prompt", "Prompt text."),
  message: optionalText("message", "Message text (alias for --prompt)."),
  file: optionalText("file", "Read prompt/message from a UTF-8 file; '-' reads stdin."),
  clientRequestId: optionalText(
    "client-request-id",
    "Stable id for safely retrying a start or send request.",
  ),
};

export const readFleetPrompt = Effect.fn("readFleetPrompt")(function* (flags: {
  readonly prompt: Option.Option<string>;
  readonly message: Option.Option<string>;
  readonly file: Option.Option<string>;
}) {
  const supplied = [flags.prompt, flags.message, flags.file].filter(Option.isSome);
  if (supplied.length !== 1)
    return yield* new FleetCliError({
      message: "Supply exactly one of --prompt, --message, or --file (use --file - for stdin).",
    });
  if (Option.isSome(flags.file)) {
    const fs = yield* FileSystem.FileSystem;
    const content =
      flags.file.value === "-"
        ? yield* Effect.tryPromise({
            try: async () => {
              let text = "";
              process.stdin.setEncoding("utf8");
              for await (const chunk of process.stdin) text += chunk;
              return text;
            },
            catch: () => new FleetCliError({ message: "Could not read stdin." }),
          })
        : yield* fs.readFileString(flags.file.value);
    if (!content.trim())
      return yield* new FleetCliError({ message: "Prompt/message must not be empty." });
    return content;
  }
  const text = Option.getOrElse(flags.prompt, () => Option.getOrThrow(flags.message));
  if (!text.trim())
    return yield* new FleetCliError({ message: "Prompt/message must not be empty." });
  return text;
});
const selected = (flags: {
  environment: Option.Option<string>;
  project: Option.Option<string>;
}) => ({
  environment: Option.getOrUndefined(flags.environment),
  project: Option.getOrUndefined(flags.project),
});
const threadFlag = Flag.String("thread").pipe(
  Flag.withDescription("Thread id on the selected environment."),
);
export const makeFleetCommand = (execute: typeof withLiveFleet = withLiveFleet) => {
  const environments = Command.make("environments", projectLocationFlags).pipe(
    Command.withDescription("List environments reachable through connected T3 clients as JSON."),
    Command.withHandler((flags) => execute(flags, (client) => client.environments())),
  );
  const projects = Command.make("projects", selectors).pipe(
    Command.withDescription("List projects on an environment as JSON."),
    Command.withHandler((flags) =>
      execute(flags, (client) =>
        invokeFleetCommand(client, { ...selected(flags), operation: "t3_project_list", input: {} }),
      ),
    ),
  );
  const capabilities = Command.make("capabilities", selectors).pipe(
    Command.withDescription("Show configured providers and models."),
    Command.withHandler((flags) =>
      execute(flags, (client) =>
        invokeFleetCommand(client, {
          ...selected(flags),
          operation: "orchestrator_capabilities",
          input: {},
        }),
      ),
    ),
  );
  const start = Command.make("start", {
    ...selectors,
    ...promptFlags,
    title: optionalText("title", "New thread title."),
    provider: optionalText("provider", "Configured provider instance id."),
    model: optionalText("model", "Provider model id."),
  }).pipe(
    Command.withDescription("Create and start a thread on the selected environment and project."),
    Command.withHandler((flags) =>
      Effect.gen(function* () {
        const message = yield* readFleetPrompt(flags);
        if (Option.isSome(flags.provider) !== Option.isSome(flags.model))
          return yield* new FleetCliError({ message: "Pass --provider and --model together." });
        return yield* execute(flags, (client) =>
          invokeFleetCommand(client, {
            ...selected(flags),
            operation: "t3_thread_launch",
            input: definedFields({
              title: Option.getOrElse(flags.title, () => "New thread"),
              message,
              clientRequestId: Option.getOrUndefined(flags.clientRequestId),
              modelSelection:
                Option.isSome(flags.provider) && Option.isSome(flags.model)
                  ? { instanceId: flags.provider.value, model: flags.model.value }
                  : undefined,
            }),
          }),
        );
      }),
    ),
  );
  const list = Command.make("list", {
    ...selectors,
    limit: Flag.Int("limit").pipe(Flag.optional),
    cursor: Flag.Int("cursor").pipe(Flag.optional),
  }).pipe(
    Command.withDescription("List threads as JSON."),
    Command.withHandler((flags) =>
      execute(flags, (client) =>
        invokeFleetCommand(client, {
          ...selected(flags),
          operation: "t3_thread_list",
          input: definedFields({
            limit: Option.getOrUndefined(flags.limit),
            cursor: Option.getOrUndefined(flags.cursor),
          }),
        }),
      ),
    ),
  );
  const read = Command.make("read", {
    ...selectors,
    thread: threadFlag,
    view: Flag.Literals("view", ["messages", "activity"]).pipe(Flag.optional),
    afterPosition: Flag.Int("after-position").pipe(Flag.optional),
    limit: Flag.Int("limit").pipe(Flag.optional),
  }).pipe(
    Command.withDescription("Read thread history as JSON."),
    Command.withHandler((flags) =>
      execute(flags, (client) =>
        invokeFleetCommand(client, {
          ...selected(flags),
          operation: "t3_thread_read",
          input: definedFields({
            threadId: flags.thread,
            view: Option.getOrUndefined(flags.view),
            afterPosition: Option.getOrUndefined(flags.afterPosition),
            limit: Option.getOrUndefined(flags.limit),
          }),
        }),
      ),
    ),
  );
  const send = Command.make("send", {
    ...selectors,
    ...promptFlags,
    thread: threadFlag,
    mode: Flag.Literals("mode", ["auto", "queue", "steer", "restart"]).pipe(Flag.optional),
  }).pipe(
    Command.withDescription("Send a message to a thread."),
    Command.withHandler((flags) =>
      Effect.gen(function* () {
        const message = yield* readFleetPrompt(flags);
        return yield* execute(flags, (client) =>
          invokeFleetCommand(client, {
            ...selected(flags),
            operation: "t3_thread_send",
            input: definedFields({
              threadId: flags.thread,
              message,
              mode: Option.getOrUndefined(flags.mode),
              clientRequestId: Option.getOrUndefined(flags.clientRequestId),
            }),
          }),
        );
      }),
    ),
  );
  const wait = Command.make("wait", {
    ...selectors,
    thread: threadFlag,
    run: optionalText("run", "Run id; defaults to latest run."),
    timeoutMs: Flag.Int("timeout-ms").pipe(Flag.optional),
  }).pipe(
    Command.withDescription("Wait for a thread run and return its outcome as JSON."),
    Command.withHandler((flags) =>
      execute(flags, (client) =>
        invokeFleetCommand(client, {
          ...selected(flags),
          operation: "t3_thread_wait",
          input: definedFields({
            threadId: flags.thread,
            runId: Option.getOrUndefined(flags.run),
            timeoutMs: Option.getOrUndefined(flags.timeoutMs),
          }),
        }),
      ),
    ),
  );
  return Command.make("fleet").pipe(
    Command.withDescription(
      "Manage threads across connected T3 environments. All results are JSON.",
    ),
    Command.withSubcommands([environments, projects, capabilities, start, list, read, send, wait]),
  );
};
export const fleetCommand = makeFleetCommand();
