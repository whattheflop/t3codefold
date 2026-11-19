import { PitbossCommand, PitbossError } from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const Reply = Schema.Struct({
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Unknown),
});
const ToolReply = Schema.Struct({
  isError: Schema.optional(Schema.Boolean),
  structuredContent: Schema.optional(Schema.Unknown),
  content: Schema.optional(
    Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
  ),
});

const isPitbossError = Schema.is(PitbossError);
const decodeReply = Schema.decodeUnknownSync(Reply);
const decodeToolReply = Schema.decodeUnknownEffect(ToolReply);
const decodeCommand = Schema.decodeUnknownEffect(Schema.fromJsonString(PitbossCommand));

/** MCP permits JSON or event-stream replies; this CLI has one request in flight. */
export function readWorkReply(body: string): unknown {
  const candidates = body.trim().startsWith("{")
    ? [body]
    : body
        .split(/\r?\n\r?\n/)
        .map((event) =>
          event
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n"),
        )
        .filter(Boolean);
  for (const candidate of candidates) {
    const reply = decodeReply(decode(candidate));
    if (reply.error !== undefined)
      throw new PitbossError({
        code: "unavailable",
        message: "The MCP request was rejected. Check the scoped session and command.",
      });
    if (reply.result !== undefined) return reply.result;
  }
  throw new PitbossError({
    code: "unavailable",
    message: "The MCP endpoint did not return a result.",
  });
}
const parseWorkReply = (body: string) =>
  Effect.try({
    try: () => readWorkReply(body),
    catch: (cause) =>
      isPitbossError(cause)
        ? cause
        : new PitbossError({ code: "unavailable", message: "The MCP reply was malformed." }),
  });

const invoke = Effect.fn("work.invoke")(function* (
  name: "work_read" | "work_command",
  input: unknown,
) {
  const endpoint = yield* Config.String("T3_WORK_ENDPOINT");
  const authorization = yield* Config.String("T3_WORK_AUTHORIZATION");
  const client = yield* HttpClient.HttpClient;
  const send = (payload: unknown, sessionId?: string) =>
    client
      .execute(
        HttpClientRequest.post(endpoint).pipe(
          HttpClientRequest.setHeaders({
            Authorization: authorization,
            "Mcp-Protocol-Version": "2025-06-18",
            Accept: "application/json, text/event-stream",
            ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
          }),
          HttpClientRequest.bodyJsonUnsafe(payload),
        ),
      )
      .pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.timeout("30 seconds"),
      );
  const initialized = yield* send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t3-work-cli", version: "1" },
    },
  });
  if (initialized.status !== 200)
    return yield* new PitbossError({
      code: "forbidden",
      message:
        "The scoped MCP session is unavailable. No administrative credential fallback is used.",
    });
  const initializedText = yield* initialized.text;
  yield* parseWorkReply(initializedText);
  const sessionId = initialized.headers["mcp-session-id"];
  yield* send({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId);
  const response = yield* send(
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: input } },
    sessionId,
  );
  const text = yield* response.text;
  const result = yield* parseWorkReply(text);
  const tool = yield* decodeToolReply(result);
  if (tool.isError)
    return yield* new PitbossError({
      code: "invalid",
      message:
        tool.content?.find((item) => item.type === "text")?.text ??
        "The work command was rejected.",
    });
  yield* Console.log(json(tool.structuredContent ?? tool.content));
}, Effect.provide(FetchHttpClient.layer));
const read = Command.make("read", {}, () => invoke("work_read", {}));
const command = Command.make(
  "command",
  {
    file: Flag.String("file").pipe(
      Flag.withDescription(
        "JSON PitbossCommand file, including stable commandId and expectedRevision.",
      ),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription(
        "Validate the command contract locally without sending it. Does not validate current authority or readiness.",
      ),
    ),
  },
  ({ file, dryRun }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const input = yield* decodeCommand(yield* fs.readFileString(file));
      if (dryRun)
        return yield* Console.log(
          json({ sent: false, contractValid: true, serverStateValidated: false, input }),
        );
      return yield* invoke("work_command", input);
    }),
);
export const workCommand = Command.make("work").pipe(
  Command.withDescription(
    "Use the current agent's scoped work protocol. Requires T3_WORK_ENDPOINT and T3_WORK_AUTHORIZATION; never uses local admin credentials.",
  ),
  Command.withSubcommands([read, command]),
);
