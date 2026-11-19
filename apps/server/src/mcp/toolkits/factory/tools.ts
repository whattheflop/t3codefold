import * as Threads from "../../../orchestration-v2/ThreadManagementService.ts";
import {
  FactoryActionEnvelope,
  FactoryAgent,
  FactoryBoard,
  FactoryCard,
  FactoryCardFileInput,
  FactoryError,
  OrchestratorMcpFailure,
  FactoryLaneJob,
  FactorySpawn,
  FactorySpawnInput,
  FactoryTrigger,
  FactoryTriggerInput,
  FactoryTriggerRun,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as Factory from "../../../factory/Factory.ts";
import * as Invocation from "../../McpInvocationContext.ts";

const dependencies = [
  Factory.Factory,
  Invocation.McpInvocationContext,
  Threads.ThreadManagementService,
];
const Failure = Schema.Union([FactoryError, OrchestratorMcpFailure]);
const board = Tool.make("factory_board", {
  description:
    "Read your Factory subtree, open decision cards, wakes, managed agents and command jobs.",
  success: FactoryBoard,
  failure: Failure,
  failureMode: "return",
  dependencies,
}).annotate(Tool.Readonly, true);
const show = Tool.make("factory_card_show", {
  description: "Read a decision card in your Factory subtree.",
  parameters: Schema.Struct({ cardId: Schema.String }),
  success: FactoryCard,
  failure: Failure,
  failureMode: "return",
  dependencies,
}).annotate(Tool.Readonly, true);
const list = Tool.make("factory_trigger_list", {
  description: "List Factory triggers and recent runs visible in your subtree.",
  success: FactoryBoard,
  failure: Failure,
  failureMode: "return",
  dependencies,
}).annotate(Tool.Readonly, true);
const spawn = Tool.make("factory_spawn", {
  description:
    "Spawn an admission-checked managed child. Commanders can open Subcommanders or Workers; Subcommanders open Workers. Reuse requestId when retrying. Completion and decisions are delivered by the Factory; do not poll.",
  parameters: FactorySpawnInput,
  success: FactorySpawn,
  failure: Failure,
  failureMode: "return",
  dependencies,
});
const update = Tool.make("factory_agent_update", {
  description: "Set needs/next for yourself or a child. Keep next short and concrete.",
  parameters: Schema.Struct({
    agentId: Schema.String,
    needs: Schema.optionalKey(Schema.NullOr(Schema.String)),
    next: Schema.optionalKey(Schema.String),
  }),
  success: FactoryAgent,
  failure: Failure,
  failureMode: "return",
  dependencies,
});
const file = Tool.make("factory_card_file", {
  description:
    "File a durable decision. Include doing/whyNotMe/costOfWaiting, sequential A..Z options with exactly one recommendation, and at least one evidence link. Only authenticated user clients can answer. Revise an open card by supplying expectedRevision.",
  parameters: FactoryCardFileInput,
  success: FactoryCard,
  failure: Failure,
  failureMode: "return",
  dependencies,
});
const withdraw = Tool.make("factory_card_withdraw", {
  description: "Withdraw one of your decision cards when its question is no longer applicable.",
  parameters: Schema.Struct({ cardId: Schema.String }),
  success: FactoryCard,
  failure: Failure,
  failureMode: "return",
  dependencies,
});
const payload = Tool.make("factory_payload_put", {
  description:
    "Store a typed outward action envelope. Returns the SHA-256 to bind to a decision card option. This does not execute anything.",
  parameters: FactoryActionEnvelope,
  success: Schema.String,
  failure: Failure,
  failureMode: "return",
  dependencies,
});
const execute = Tool.make("factory_execute_action", {
  description:
    "Execute exactly the stored action approved by a user's decision-card answer. Missing/stale/mismatched consent is refused. Unknown outcomes are not automatically retried. Use this tool for outward work; never bypass it using another command runner.",
  parameters: Schema.Struct({ cardId: Schema.String }),
  success: Schema.Struct({ id: Schema.String, state: Schema.String, result: Schema.String }),
  failure: Failure,
  failureMode: "return",
  dependencies,
});
const ack = Tool.make("factory_ack", {
  description:
    "Acknowledge a delivered wake after handling it. Copy refKind/refId from its ref marker. Acknowledgement does not authorise an outward action.",
  parameters: Schema.Struct({ refKind: Schema.String, refId: Schema.String }),
  success: Schema.Void,
  failure: Failure,
  failureMode: "return",
  dependencies,
});
const defer = Tool.make("factory_defer", {
  description:
    "Defer one of your wakes until a future UTC epoch millisecond timestamp. This suppresses redelivery during the defer.",
  parameters: Schema.Struct({ wakeId: Schema.String, until: Schema.Number }),
  success: Schema.Void,
  failure: Failure,
  failureMode: "return",
  dependencies,
});
const trigger = Tool.make("factory_trigger_upsert", {
  description:
    "Commander only: configure a model-free scheduled check, keyed-item rearming, target and prompt. Start in shadow to inspect behavior. Command checks must use a server-registered executable and be read-only.",
  parameters: FactoryTriggerInput,
  success: FactoryTrigger,
  failure: Failure,
  failureMode: "return",
  dependencies,
});
const run = Tool.make("factory_trigger_run", {
  description: "Commander only: run a configured model-free Factory check now.",
  parameters: Schema.Struct({ id: Schema.String }),
  success: FactoryTriggerRun,
  failure: Failure,
  failureMode: "return",
  dependencies,
});
const heavy = Tool.make("factory_run_heavy", {
  description:
    "Queue a test/build/typecheck command in the shared heavy lanes. Reuse requestId on retry. Completion wakes your thread; end your turn rather than polling. This is not an outward-action approval tool.",
  parameters: Schema.Struct({
    requestId: Schema.String,
    cwd: Schema.String,
    argv: Schema.Array(Schema.String),
    timeoutMs: Schema.Number,
    frozenHead: Schema.optionalKey(Schema.String),
    priority: Schema.optionalKey(Schema.Number),
  }),
  success: Schema.Struct({ job: FactoryLaneJob, next: Schema.String }),
  failure: Failure,
  failureMode: "return",
  dependencies,
});

export const FactoryToolkit = Toolkit.make(
  board,
  show,
  list,
  spawn,
  update,
  file,
  withdraw,
  payload,
  execute,
  ack,
  defer,
  trigger,
  run,
  heavy,
);
