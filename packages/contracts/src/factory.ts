import * as Schema from "effect/Schema";
import { EnvironmentId, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

const Id = TrimmedNonEmptyString.check(Schema.isMaxLength(160));
const Text = Schema.String.check(Schema.isMaxLength(16_384));
const Stamp = Schema.Number;
const RecordFields = { id: Id, version: Schema.Number, createdAt: Stamp, updatedAt: Stamp };

export class FactoryError extends Schema.TaggedError<FactoryError>()("FactoryError", {
  code: Schema.Literals([
    "invalid",
    "conflict",
    "forbidden",
    "not-found",
    "unavailable",
    "disabled",
    "storage",
  ]),
  entityId: Schema.optionalKey(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    switch (this.code) {
      case "invalid":
        return "The Factory request is invalid.";
      case "conflict":
        return "Factory state changed. Reload and try again.";
      case "forbidden":
        return "This caller cannot perform that Factory operation.";
      case "not-found":
        return "The Factory item was not found.";
      case "disabled":
        return "Factory is disabled on this server.";
      case "unavailable":
        return "This Factory operation is temporarily unavailable.";
      case "storage":
        return "Factory persistence failed.";
    }
  }
}

export const FactoryAgent = Schema.Struct({
  ...RecordFields,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  projectId: ProjectId,
  role: Schema.Literals(["commander", "subcommander", "worker"]),
  parentId: Schema.NullOr(Id),
  generation: Schema.Number,
  lifecycle: Schema.Literals(["launching", "active", "parked", "retired", "closed"]),
  capsule: Text,
  capsuleRevision: Schema.Number,
  needs: Schema.NullOr(Schema.String),
  next: Schema.String,
});
export type FactoryAgent = typeof FactoryAgent.Type;

export const FactoryActionEnvelope = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literals(["merge", "open-pr", "force-push", "delete-branch", "external-post"]),
  repository: TrimmedNonEmptyString,
  target: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
  count: Schema.Literal(1),
  request: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("merge"),
      prNumber: Schema.Number,
      approvedHeadSha: TrimmedNonEmptyString,
      method: Schema.Literals(["squash", "merge", "rebase"]),
    }),
    Schema.Struct({
      type: Schema.Literal("open-pr"),
      head: TrimmedNonEmptyString,
      base: TrimmedNonEmptyString,
      title: TrimmedNonEmptyString,
      body: Text,
      draft: Schema.Boolean,
    }),
    Schema.Struct({
      type: Schema.Literal("force-push"),
      newOid: TrimmedNonEmptyString,
      destinationRef: TrimmedNonEmptyString,
      expectedOldOid: TrimmedNonEmptyString,
    }),
    Schema.Struct({
      type: Schema.Literal("delete-branch"),
      destinationRef: TrimmedNonEmptyString,
      expectedOldOid: TrimmedNonEmptyString,
    }),
    Schema.Struct({
      type: Schema.Literal("external-post"),
      adapter: Schema.Literal("github-comment"),
      issueNumber: Schema.Number,
      body: Text,
    }),
  ]),
});
export type FactoryActionEnvelope = typeof FactoryActionEnvelope.Type;

export const FactoryCardBody = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  kind: Schema.Literals(["decision", "housekeeping", "fyi-chose"]),
  blocking: Schema.Boolean,
  urgency: Schema.Literals(["now", "today", "this-week"]),
  context: Schema.Struct({
    doing: TrimmedNonEmptyString,
    whyNotMe: TrimmedNonEmptyString,
    costOfWaiting: TrimmedNonEmptyString,
  }),
  options: Schema.Array(
    Schema.Struct({
      id: TrimmedNonEmptyString,
      label: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
      recommended: Schema.Boolean,
      nextStep: Text,
      cost: Text,
      reversibility: Schema.Literals(["reversible", "costly", "irreversible"]),
      consequences: Text,
    }),
  ).check(Schema.isMaxLength(26)),
  rationale: Text,
  caveats: Schema.Array(Text),
  links: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["pr", "thread", "code", "url", "image", "spec"]),
      ref: TrimmedNonEmptyString,
      label: Schema.optionalKey(Text),
    }),
  ),
  action: Schema.optionalKey(Schema.Struct({ optionId: Id, payloadSha256: TrimmedNonEmptyString })),
});
export type FactoryCardBody = typeof FactoryCardBody.Type;
export const FactoryCard = Schema.Struct({
  ...RecordFields,
  authorId: Id,
  ownerId: Id,
  revision: Schema.Number,
  body: FactoryCardBody,
  state: Schema.Literals(["open", "answered", "acked", "withdrawn", "superseded"]),
  outcome: Schema.NullOr(Schema.Literals(["CHOSE", "CHOSE-against", "DEFAULTED", "RULED"])),
  optionId: Schema.NullOr(Id),
  note: Text,
  answeredAt: Schema.NullOr(Stamp),
});
export type FactoryCard = typeof FactoryCard.Type;
export const FactoryPayload = Schema.Struct({
  ...RecordFields,
  ownerId: Id,
  sha256: Id,
  envelope: FactoryActionEnvelope,
});
export type FactoryPayload = typeof FactoryPayload.Type;

export const FactoryWake = Schema.Struct({
  ...RecordFields,
  targetId: Id,
  routingEpoch: Schema.Number,
  refKind: Id,
  refId: Id,
  text: Text,
  sourceId: Id,
  sourceEpoch: Schema.Number,
  state: Schema.Literals([
    "queued",
    "held",
    "delivered",
    "acked",
    "deferred",
    "undelivered",
    "cancelled",
  ]),
  holdReason: Schema.NullOr(Schema.String),
  attempts: Schema.Number,
  nextAttemptAt: Stamp,
  deferUntil: Schema.NullOr(Stamp),
  deliveryId: Schema.NullOr(Id),
});
export type FactoryWake = typeof FactoryWake.Type;
export const FactorySource = Schema.Struct({
  ...RecordFields,
  epoch: Schema.Number,
  state: Schema.Literals(["active", "terminal-authorized", "revoked"]),
});
export type FactorySource = typeof FactorySource.Type;
export const FactoryDelivery = Schema.Struct({
  ...RecordFields,
  targetId: Id,
  threadId: ThreadId,
  routingEpoch: Schema.Number,
  sourceId: Id,
  sourceEpoch: Schema.Number,
  wakeIds: Schema.Array(Id),
  attempt: Schema.Number,
  text: Text,
  commandId: Id,
  messageId: Id,
  state: Schema.Literals(["claimed", "accepted", "cancelled"]),
});
export type FactoryDelivery = typeof FactoryDelivery.Type;
export const FactoryDeliveryMetadata = Schema.Struct({
  deliveryId: Id,
  routingEpoch: Schema.Number,
  sourceId: Id,
  sourceEpoch: Schema.Number,
});
export type FactoryDeliveryMetadata = typeof FactoryDeliveryMetadata.Type;

export const FactoryTriggerCheck = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("builtin"),
    name: Schema.Literals(["stall-watch", "health-watch", "decisions-stale", "usage-quota"]),
  }),
  Schema.Struct({
    type: Schema.Literal("command"),
    projectId: ProjectId,
    argv: Schema.Array(TrimmedNonEmptyString),
  }),
]);
export const FactoryTrigger = Schema.Struct({
  ...RecordFields,
  ownerId: Id,
  targetId: Id,
  intervalMs: Schema.Number,
  check: FactoryTriggerCheck,
  prompt: Text,
  rearm: Schema.Union([
    Schema.Struct({ type: Schema.Literal("never") }),
    Schema.Struct({ type: Schema.Literal("after"), milliseconds: Schema.Number }),
    Schema.Struct({ type: Schema.Literal("on-change"), field: Id }),
  ]),
  enabled: Schema.Boolean,
  shadow: Schema.Boolean,
  nextRunAt: Stamp,
  errors: Schema.Number,
  transientSince: Schema.NullOr(Stamp),
  failing: Schema.Boolean,
});
export type FactoryTrigger = typeof FactoryTrigger.Type;
export const FactoryCheckItem = Schema.Struct({
  key: Id,
  summary: Text,
  data: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
export type FactoryCheckItem = typeof FactoryCheckItem.Type;
export const FactoryTriggerRun = Schema.Struct({
  ...RecordFields,
  triggerId: Id,
  outcome: Schema.Literals(["running", "quiet", "woke", "shadow", "transient", "error"]),
  itemCount: Schema.Number,
  newItemCount: Schema.Number,
  tookMs: Schema.Number,
  stderr: Text,
});
export type FactoryTriggerRun = typeof FactoryTriggerRun.Type;
export const FactoryTriggerItem = Schema.Struct({
  ...RecordFields,
  triggerId: Id,
  key: Id,
  value: Schema.String,
  lastSeen: Stamp,
  lastWoke: Schema.NullOr(Stamp),
  shadowOnly: Schema.Boolean,
});
export type FactoryTriggerItem = typeof FactoryTriggerItem.Type;

export const FactorySpawn = Schema.Struct({
  ...RecordFields,
  parentId: Schema.NullOr(Id),
  agentId: Id,
  threadId: ThreadId,
  projectId: ProjectId,
  role: Schema.Literals(["commander", "subcommander", "worker"]),
  generation: Schema.Number,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  prompt: Text,
  capsule: Text,
  workspace: Schema.Literals(["root", "worktree"]),
  baseRef: TrimmedNonEmptyString,
  state: Schema.Literals(["pending", "held", "reserved", "launching", "launched", "cancelled"]),
  retryAt: Stamp,
  reservedAt: Schema.NullOr(Stamp),
});
export type FactorySpawn = typeof FactorySpawn.Type;
export const FactoryExecution = Schema.Struct({
  ...RecordFields,
  cardId: Id,
  cardRevision: Schema.Number,
  optionId: Id,
  payloadSha256: Id,
  state: Schema.Literals(["claimed", "executing", "succeeded", "failed", "unknown"]),
  result: Text,
});
export type FactoryExecution = typeof FactoryExecution.Type;
export const FactoryLaneJob = Schema.Struct({
  ...RecordFields,
  ownerId: Id,
  cwd: TrimmedNonEmptyString,
  gitRoot: TrimmedNonEmptyString,
  argv: Schema.Array(TrimmedNonEmptyString),
  lane: Schema.Literals(["heavy", "light"]),
  priority: Schema.Number,
  timeoutMs: Schema.Number,
  frozenHead: Schema.NullOr(Id),
  startedAt: Schema.NullOr(Stamp),
  state: Schema.Literals(["queued", "launching", "running", "quarantined", "terminal"]),
  status: Schema.NullOr(
    Schema.Literals([
      "ok",
      "failed",
      "timeout",
      "head_moved",
      "cancelled",
      "gave_up",
      "bad_cwd",
      "launch_failed",
    ]),
  ),
  rc: Schema.NullOr(Schema.Number),
  outputPath: Schema.String,
  supervisor: Schema.NullOr(Schema.String),
  cancelRequested: Schema.optionalKey(Schema.Boolean),
});
export type FactoryLaneJob = typeof FactoryLaneJob.Type;
export const FactoryStall = Schema.Struct({
  ...RecordFields,
  agentId: Id,
  lastActivityAt: Stamp,
  escalated: Schema.Boolean,
  closed: Schema.Boolean,
});
export type FactoryStall = typeof FactoryStall.Type;
export const FactoryNotification = Schema.Struct({
  ...RecordFields,
  cardId: Id,
  cardRevision: Schema.Number,
  threadId: ThreadId,
  occurrence: Schema.Number,
  level: Schema.Literals(["P0", "P1", "badge"]),
  dueAt: Stamp,
  expiresAt: Stamp,
  state: Schema.Literals(["pending", "accepted", "cancelled"]),
});
export type FactoryNotification = typeof FactoryNotification.Type;

export const FactoryControlRecord = Schema.Struct({
  ...RecordFields,
  enabled: Schema.Boolean,
  pendingThreadStops: Schema.Array(ThreadId),
});
export type FactoryControlRecord = typeof FactoryControlRecord.Type;
export const FactoryStatus = Schema.Struct({
  enabled: Schema.Boolean,
  forcedOff: Schema.Boolean,
  stopping: Schema.Boolean,
});
export type FactoryStatus = typeof FactoryStatus.Type;

export const FactorySchemas = {
  control: FactoryControlRecord,
  agents: FactoryAgent,
  cards: FactoryCard,
  payloads: FactoryPayload,
  wakes: FactoryWake,
  sources: FactorySource,
  deliveries: FactoryDelivery,
  triggers: FactoryTrigger,
  runs: FactoryTriggerRun,
  items: FactoryTriggerItem,
  spawns: FactorySpawn,
  executions: FactoryExecution,
  jobs: FactoryLaneJob,
  stalls: FactoryStall,
  notifications: FactoryNotification,
} as const;
export type FactoryEntityKind = keyof typeof FactorySchemas;
export type FactoryEntityMap = { [K in FactoryEntityKind]: (typeof FactorySchemas)[K]["Type"] };
export const FactoryBoard = Schema.Struct({
  status: FactoryStatus,
  environmentId: EnvironmentId,
  sequence: Schema.Number,
  agents: Schema.Array(FactoryAgent),
  cards: Schema.Array(FactoryCard),
  wakes: Schema.Array(FactoryWake),
  triggers: Schema.Array(FactoryTrigger),
  runs: Schema.Array(FactoryTriggerRun),
  jobs: Schema.Array(FactoryLaneJob),
  spawns: Schema.Array(FactorySpawn),
  executions: Schema.Array(FactoryExecution),
});
export type FactoryBoard = typeof FactoryBoard.Type;

export const FactoryEnsureCommanderInput = Schema.Struct({ modelSelection: ModelSelection });
export const FactorySpawnInput = Schema.Struct({
  requestId: Id,
  parentId: Id,
  role: Schema.Literals(["subcommander", "worker"]),
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  prompt: Text,
  capsule: Text,
  workspace: Schema.optionalKey(Schema.Literals(["root", "worktree"])),
  baseRef: Schema.optionalKey(TrimmedNonEmptyString),
});
export type FactorySpawnInput = typeof FactorySpawnInput.Type;
export const FactoryAnswerInput = Schema.Struct({
  cardId: Id,
  revision: Schema.Number,
  optionId: Schema.optionalKey(Id),
  note: Schema.optionalKey(Text),
  yourCall: Schema.optionalKey(Schema.Boolean),
});
export type FactoryAnswerInput = typeof FactoryAnswerInput.Type;
export const FactoryLifecycleInput = Schema.Struct({
  agentId: Id,
  state: Schema.Literals(["active", "parked", "closed"]),
});
export const FactoryTriggerInput = Schema.Struct({
  id: Id,
  targetId: Id,
  intervalMs: Schema.Number,
  check: FactoryTriggerCheck,
  prompt: Text,
  rearm: FactoryTrigger.fields.rearm,
  enabled: Schema.Boolean,
  shadow: Schema.Boolean,
});
export const FactoryWakeInput = Schema.Struct({
  wakeId: Id,
  until: Schema.optionalKey(Stamp),
  reason: Schema.optionalKey(Text),
});
export const FactoryCardFileInput = Schema.Struct({
  id: Id,
  expectedRevision: Schema.optionalKey(Schema.Number),
  body: FactoryCardBody,
});

export function validateFactoryCard(body: FactoryCardBody): boolean {
  return (
    body.links.length > 0 &&
    body.options.length > 0 &&
    (body.kind !== "decision" || body.options.length >= 2) &&
    body.options.filter((o) => o.recommended).length === 1 &&
    body.options.every((o, i) => o.id === String.fromCharCode(65 + i)) &&
    (body.action === undefined || body.options.some((o) => o.id === body.action?.optionId))
  );
}
