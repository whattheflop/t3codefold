import { PitbossSourceAuthority } from "./pitbossAuthority.ts";
import * as Schema from "effect/Schema";
import {
  EnvironmentId,
  CommandId,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import {
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
  type OrchestrationV2RuntimeRequest,
} from "./orchestrationV2.ts";
import type { RuntimeMode } from "./providerPolicy.ts";

const runtimeModeRank = (mode: RuntimeMode) => {
  switch (mode) {
    case "approval-required":
      return 0;
    case "auto-accept-edits":
      return 1;
    case "auto":
      return 2;
    case "full-access":
      return 3;
  }
};

/** True when `mode` grants the agent more autonomy than `boundary` allows. */
export const isRuntimeModeBroaderThan = (mode: RuntimeMode, boundary: RuntimeMode) =>
  runtimeModeRank(mode) > runtimeModeRank(boundary);

/**
 * A pending request the user must approve before the agent may proceed. The agent asking its own
 * question and a credential that needs refreshing block the same way but are not approvals, and
 * both the server and the clients must classify them identically.
 */
export const isPendingApprovalRequest = (
  request: { readonly kind: OrchestrationV2RuntimeRequest["kind"] } | null | undefined,
) => !!request && request.kind !== "user_input" && request.kind !== "auth_refresh";

const Text = Schema.String.check(Schema.isMaxLength(16000));
const Id = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const Version = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const PitbossRuntimeMode = Schema.Literals(["approval-required", "full-access"]);
export const PitbossBrief = Schema.Struct({
  priorities: Text,
  quality: Text,
  projectIds: Schema.Array(ProjectId).check(Schema.isMaxLength(50)),
  maxWorkers: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
  maxAttempts: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 })),
  workerModel: ModelSelection,
  alternateWorkerModel: Schema.optional(ModelSelection),
  modelGuidance: Schema.optional(Text),
  managedPeerIds: Schema.optional(Schema.Array(Id).check(Schema.isMaxLength(50))),
  coordinatorRuntimeMode: Schema.optional(PitbossRuntimeMode),
  workerRuntimeMode: Schema.optional(PitbossRuntimeMode),
  verificationMode: Schema.optional(Schema.Literals(["user-approved", "automatic"])),
});
export type PitbossBrief = typeof PitbossBrief.Type;
export const PITBOSS_DEFAULT_QUALITY =
  "Show evidence that the requested outcome works and preserve existing behavior outside scope.";
export const PITBOSS_DEFAULT_MODEL_GUIDANCE =
  "Use the default worker for well-scoped implementation and verification. Choose the alternative when the task needs a different strength, deeper investigation, or recovery from a blocker. Explain the choice and keep the verification standard the same.";
/** The brief every client starts from, so GLaDOS behaves the same wherever it was set up. */
export function defaultPitbossBrief(input: {
  workerModel: ModelSelection;
  projectIds: ReadonlyArray<ProjectId>;
  priorities?: string;
}): PitbossBrief {
  return withPitbossAutonomy(
    {
      priorities: input.priorities ?? "",
      quality: PITBOSS_DEFAULT_QUALITY,
      projectIds: [...input.projectIds],
      maxWorkers: 3,
      maxAttempts: 3,
      workerModel: input.workerModel,
      managedPeerIds: [],
    },
    "ask",
  );
}
/**
 * Autonomy is the one permission choice users make. It sets GLaDOS permissions, worker
 * permissions and verification together; "custom" only describes older mixed briefs.
 */
export type PitbossAutonomy = "ask" | "full-auto";
export function pitbossAutonomy(brief: PitbossBrief): PitbossAutonomy | "custom" {
  const full =
    brief.coordinatorRuntimeMode === "full-access" &&
    brief.workerRuntimeMode === "full-access" &&
    brief.verificationMode === "automatic";
  const ask =
    (brief.coordinatorRuntimeMode ?? "approval-required") === "approval-required" &&
    (brief.workerRuntimeMode ?? "approval-required") === "approval-required" &&
    (brief.verificationMode ?? "user-approved") === "user-approved";
  return full ? "full-auto" : ask ? "ask" : "custom";
}
export function withPitbossAutonomy(brief: PitbossBrief, autonomy: PitbossAutonomy): PitbossBrief {
  const full = autonomy === "full-auto";
  return {
    ...brief,
    coordinatorRuntimeMode: full ? "full-access" : "approval-required",
    workerRuntimeMode: full ? "full-access" : "approval-required",
    verificationMode: full ? "automatic" : "user-approved",
  };
}
export const PitbossRole = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  generation: Version,
  paused: Schema.Boolean,
  brief: PitbossBrief,
});
export type PitbossRole = typeof PitbossRole.Type;
export const PitbossVerificationRecipe = Schema.Struct({
  profileId: Schema.optional(Id),
  mode: Schema.optional(Schema.Literals(["commit", "artifact", "observation"])),
  environmentId: Schema.optional(EnvironmentId),
  inputPath: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(240))),
  target: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(240))),
  maxAgeSeconds: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 604800 })),
  ),
  effects: Schema.optional(Schema.Literals(["observe", "host-commands"])),
  enabled: Schema.optional(Schema.Boolean),
  projectId: ProjectId,
  version: Version,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  doctor: TrimmedNonEmptyString.check(Schema.isMaxLength(4000)),
  verify: TrimmedNonEmptyString.check(Schema.isMaxLength(4000)),
  cleanup: Text,
  timeoutSeconds: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 300 })),
  artifacts: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(240))).check(
    Schema.isMaxLength(5),
  ),
});
export type PitbossVerificationRecipe = typeof PitbossVerificationRecipe.Type;
export const PitbossVerificationCheck = Schema.Struct({
  name: Schema.String,
  command: Schema.String,
  code: Schema.NullOr(Schema.Int),
  timedOut: Schema.Boolean,
  stdout: Schema.String.check(Schema.isMaxLength(4096)),
  stderr: Schema.String.check(Schema.isMaxLength(4096)),
});
export const PitbossVerificationReceipt = Schema.Struct({
  verdict: Schema.Literals(["pass", "fail", "inconclusive"]),
  summary: Text,
  checks: Schema.Array(PitbossVerificationCheck).check(Schema.isMaxLength(3)),
  artifacts: Schema.Array(
    Schema.Struct({ name: Schema.String, attachmentId: Schema.String }),
  ).check(Schema.isMaxLength(5)),
  environmentId: Schema.optional(EnvironmentId),
  subjectDigest: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.String),
  finishedAt: Schema.String,
});
export type PitbossVerificationReceipt = typeof PitbossVerificationReceipt.Type;
export const PitbossVerification = Schema.Struct({
  id: Id,
  state: Schema.Literals(["pending", "running", "completed"]),
  candidate: Schema.String,
  attemptId: Id,
  criteriaVersion: Version,
  recipe: PitbossVerificationRecipe,
  requestedAt: Schema.String,
  receipt: Schema.optional(PitbossVerificationReceipt),
});
export type PitbossVerification = typeof PitbossVerification.Type;
/** Captured execution is distinct from review judgment and must match the current recipe. */
export function hasCurrentVerification(
  task: PitbossTask,
  recipe: PitbossVerificationRecipe | undefined,
  candidate: string,
  // Pure callers can supply their observation time; UI callers use wall time.
  // @effect-diagnostics-next-line globalDate:off
  now = Date.now(),
) {
  const run = task.verification;
  return (
    !!run &&
    run.state === "completed" &&
    run.receipt?.verdict === "pass" &&
    run.candidate === candidate &&
    run.criteriaVersion === task.criteriaVersion &&
    recipe?.enabled !== false &&
    (!run.receipt.expiresAt || Date.parse(run.receipt.expiresAt) > now) &&
    (run.recipe.profileId ?? "default") === (recipe?.profileId ?? "default") &&
    run.recipe.version === recipe?.version &&
    run.recipe.projectId === task.projectId
  );
}
/** Legacy project recipes remain defaults; explicit selections are durable task contracts. */
export function verificationRecipeForTask(state: PitbossSnapshot, task: PitbossTask) {
  if (task.verificationProfileId === null) return undefined;
  return state.verificationRecipes?.find(
    (recipe) =>
      recipe.projectId === task.projectId &&
      (recipe.profileId ?? "default") === (task.verificationProfileId ?? "default"),
  );
}

export const PitbossEvidence = Schema.Struct({
  capture: Schema.optional(
    Schema.Struct({
      profileId: Schema.optional(Id),
      recipeVersion: Version,
      recipeName: Schema.String,
      receipt: PitbossVerificationReceipt,
    }),
  ),
  id: Id,
  attemptId: Id,
  criteriaVersion: Version,
  candidate: TrimmedNonEmptyString,
  verdict: Schema.Literals(["pass", "fail", "inconclusive"]),
  summary: Text,
  command: Text,
  artifactUrls: Schema.Array(Text).check(Schema.isMaxLength(20)),
  provenance: Schema.Literals([
    "worker_report",
    "user_observation",
    "captured_check",
    "coordinator_review",
  ]),
  createdAt: Schema.String,
});
export type PitbossEvidence = typeof PitbossEvidence.Type;
export const PitbossAttempt = Schema.Struct({
  runtimeMode: Schema.optional(PitbossRuntimeMode),
  id: Id,
  threadId: ThreadId,
  generation: Version,
  state: Schema.Literals([
    "pending",
    "running",
    "submitted",
    "stop_requested",
    "stopped",
    "failed",
  ]),
  model: ModelSelection,
  createdAt: Schema.String,
  detail: Text,
  workspacePath: Schema.optional(Schema.String),
});
export type PitbossAttempt = typeof PitbossAttempt.Type;
export const PitbossSource = Schema.Struct({
  kind: Schema.Literals(["vikunja", "jira", "linear"]),
  tenantId: Id,
  itemId: Id,
  scope: Schema.optional(Id),
  contentDigest: Schema.optional(Id),
  ownership: Schema.optional(
    Schema.Struct({
      viewerId: Id,
      assigneeId: Schema.NullOr(Id),
      delegateId: Schema.NullOr(Id),
    }),
  ),
  key: Text,
  url: Text,
  status: Text,
  priority: Text,
  observedAt: Schema.String,
});
export type PitbossSource = typeof PitbossSource.Type;
export const PitbossLead = Schema.Struct({
  runtimeMode: Schema.optional(PitbossRuntimeMode),
  id: Id,
  threadId: ThreadId,
  projectId: ProjectId,
  generation: Version,
  parentGeneration: Version,
  status: Schema.Literals(["active", "dormant"]),
  charter: TrimmedNonEmptyString.check(Schema.isMaxLength(16000)),
  model: ModelSelection,
  maxWorkers: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
  context: Text,
  contextRevision: Version,
  updatedAt: Schema.String,
});
export type PitbossLead = typeof PitbossLead.Type;

/** Effective project authority, shared by the server and every client. */
export function isPitbossLeadActive(role: PitbossRole | null | undefined, lead: PitbossLead) {
  return (
    lead.status === "active" &&
    lead.parentGeneration === role?.generation &&
    role.brief.projectIds.includes(lead.projectId)
  );
}

export const PitbossDecision = Schema.Struct({
  id: Id,
  question: TrimmedNonEmptyString.check(Schema.isMaxLength(4000)),
  options: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(400))).check(
    Schema.isMaxLength(6),
  ),
  recommendation: Text,
  requestedAt: Schema.String,
  answer: Schema.optional(Text),
  resolvedAt: Schema.optional(Schema.String),
});
export type PitbossDecision = typeof PitbossDecision.Type;

export const PitbossTask = Schema.Struct({
  proposedVerificationRecipe: Schema.optional(PitbossVerificationRecipe),
  reworkRequestedAt: Schema.optional(Schema.String),
  revisionRequest: Schema.optional(
    Schema.Struct({
      id: Id,
      note: TrimmedNonEmptyString,
      requestedAt: Schema.String,
      model: Schema.optional(ModelSelection),
      runtimeMode: Schema.optional(PitbossRuntimeMode),
    }),
  ),
  closedAt: Schema.optional(Schema.String),
  closedReason: Schema.optional(TrimmedNonEmptyString),
  proposedVerificationDigest: Schema.optional(Id),
  proposedVerificationDecisionId: Schema.optional(Id),
  approvedVerificationProposal: Schema.optional(
    Schema.Struct({
      decisionId: Id,
      profileId: Schema.optional(Id),
      version: Version,
      digest: Id,
    }),
  ),
  decisions: Schema.optional(Schema.Array(PitbossDecision).check(Schema.isMaxLength(20))),
  verificationProfileId: Schema.optional(Schema.NullOr(Id)),
  verification: Schema.optional(PitbossVerification),
  leadId: Schema.optional(Id),
  ownershipRevision: Schema.optional(Version),
  pendingOperationId: Schema.optional(Id),
  homeEnvironmentId: Schema.optional(EnvironmentId),
  homeRevision: Schema.optional(Version),
  id: Id,
  revision: Version,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  outcome: Text,
  criteria: TrimmedNonEmptyString,
  criteriaVersion: Version,
  verifyCommand: Text,
  priority: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  dependencies: Schema.Array(Id).check(Schema.isMaxLength(50)),
  workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy,
  status: Schema.Literals(["queued", "active", "verifying", "done", "blocked", "cancelled"]),
  attempts: Schema.Array(PitbossAttempt),
  evidence: Schema.Array(PitbossEvidence),
  source: Schema.NullOr(PitbossSource),
  note: Text,
  acceptedEvidenceId: Schema.NullOr(Id),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type PitbossTask = typeof PitbossTask.Type;
export const PitbossMessage = Schema.Struct({
  recipientLeadId: Schema.optional(Id),
  sourcePeerId: Schema.optional(Id),
  sourceMessageId: Schema.optional(Id),
  replyTo: Schema.optional(Id),
  id: Id,
  taskId: Schema.NullOr(Id),
  threadId: Schema.NullOr(ThreadId),
  kind: Schema.Literals(["question", "progress", "result", "decision"]),
  /** Agent-facing detail. Carries the obligation and its exact next action. */
  text: Text,
  /** Human-facing one-liner for the board, inbox and chat. Absent on agent-authored text. */
  headline: Schema.optional(Text),
  createdAt: Schema.String,
  acknowledged: Schema.Boolean,
});
export type PitbossMessage = typeof PitbossMessage.Type;
export const PitbossSnapshot = Schema.Struct({
  /**
   * Live worker attempts whose thread is parked on a runtime permission prompt only the user can
   * answer. Observed from thread shells on every drain and never journaled: it appears and clears
   * with the prompt itself, so it carries no revision and no settlement obligation.
   */
  awaitingApproval: Schema.optional(Schema.Array(Id)),
  verificationRecipes: Schema.optional(Schema.Array(PitbossVerificationRecipe)),
  /** A durable board archive is draining writers before its visible projection is removed. */
  boardClear: Schema.optional(
    Schema.Struct({
      operationId: Id,
      generation: Version,
      requestedAt: Schema.String,
      taskIds: Schema.Array(Id),
      leadIds: Schema.Array(Id),
      messageIds: Schema.Array(Id),
    }),
  ),
  /** Durable task tombstones that fence messages and callbacks arriving after a board archive. */
  archivedTaskIds: Schema.optional(Schema.Array(Id)),
  leads: Schema.optional(Schema.Array(PitbossLead)),
  sourceAuthorities: Schema.optional(Schema.Array(PitbossSourceAuthority)),
  revision: Version,
  role: Schema.NullOr(PitbossRole),
  tasks: Schema.Array(PitbossTask),
  messages: Schema.Array(PitbossMessage),
});
export type PitbossSnapshot = typeof PitbossSnapshot.Type;
const TaskFields = {
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  outcome: Text,
  criteria: TrimmedNonEmptyString,
  verifyCommand: Text,
  priority: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  dependencies: Schema.Array(Id).check(Schema.isMaxLength(50)),
  workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy,
};
export const PitbossAction = Schema.Union([
  Schema.Struct({ type: Schema.Literal("activate-home"), brief: PitbossBrief }),
  Schema.Struct({
    type: Schema.Literal("propose-verification"),
    taskId: Id,
    recipe: PitbossVerificationRecipe,
  }),
  Schema.Struct({
    type: Schema.Literal("request-decision"),
    taskId: Id,
    question: PitbossDecision.fields.question,
    options: PitbossDecision.fields.options,
    recommendation: Text,
  }),
  Schema.Struct({
    type: Schema.Literal("resolve-decision"),
    taskId: Id,
    decisionId: Id,
    answer: TrimmedNonEmptyString.check(Schema.isMaxLength(4000)),
  }),
  Schema.Struct({
    type: Schema.Literal("approve-verification"),
    taskId: Id,
    decisionId: Id,
    proposalVersion: Version,
    proposalDigest: Id,
  }),
  Schema.Struct({
    type: Schema.Literal("verification-profile"),
    taskId: Id,
    profileId: Schema.NullOr(Id),
  }),
  Schema.Struct({
    type: Schema.Literal("verification-recipe"),
    recipe: PitbossVerificationRecipe,
    selectForTaskId: Schema.optional(Id),
  }),
  Schema.Struct({ type: Schema.Literal("verify"), taskId: Id, evidenceId: Id }),
  Schema.Struct({
    type: Schema.Literal("lead-message"),
    leadId: Id,
    text: TrimmedNonEmptyString.check(Schema.isMaxLength(16000)),
  }),
  Schema.Struct({
    type: Schema.Literal("create-lead"),
    leadId: Id,
    projectId: ProjectId,
    charter: PitbossLead.fields.charter,
    model: ModelSelection,
    maxWorkers: PitbossLead.fields.maxWorkers,
    runtimeMode: Schema.optional(PitbossRuntimeMode),
  }),
  Schema.Struct({
    type: Schema.Literal("lead-status"),
    leadId: Id,
    status: PitbossLead.fields.status,
    runtimeMode: Schema.optional(PitbossRuntimeMode),
  }),
  Schema.Struct({ type: Schema.Literal("lead-context"), leadId: Id, context: Text }),
  Schema.Struct({
    type: Schema.Literal("lead-report"),
    leadId: Id,
    text: TrimmedNonEmptyString.check(Schema.isMaxLength(16000)),
    taskIds: Schema.Array(Id).check(Schema.isMaxLength(50)),
    kind: Schema.Literals(["question", "progress", "result"]),
  }),
  Schema.Struct({ type: Schema.Literal("manage-task"), taskId: Id, leadId: Schema.NullOr(Id) }),
  Schema.Struct({
    type: Schema.Literal("send-peer"),
    peerId: Id,
    text: TrimmedNonEmptyString.check(Schema.isMaxLength(12000)),
    replyTo: Schema.optional(Id),
  }),
  Schema.Struct({
    type: Schema.Literal("propose-coordination"),
    peerId: Id,
    coordinator: EnvironmentId,
  }),
  Schema.Struct({
    type: Schema.Literal("elect"),
    startCoordinator: Schema.optional(Schema.Boolean),
    threadId: ThreadId,
    projectId: ProjectId,
    brief: PitbossBrief,
  }),
  Schema.Struct({ type: Schema.Literal("dismiss") }),
  /** Archives the visible board while retaining its journal, threads, worktrees and role. */
  Schema.Struct({ type: Schema.Literal("clear-board") }),
  /** Cancels open local work and gives GLaDOS a fresh home thread; the brief is kept. */
  Schema.Struct({ type: Schema.Literal("reset") }),
  Schema.Struct({ type: Schema.Literal("pause"), paused: Schema.Boolean }),
  Schema.Struct({
    type: Schema.Literal("brief"),
    brief: PitbossBrief,
    applyCoordinatorPermissions: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ type: Schema.Literal("create"), taskId: Id, ...TaskFields }),
  Schema.Struct({ type: Schema.Literal("edit"), taskId: Id, ...TaskFields }),
  Schema.Struct({
    type: Schema.Literal("assign"),
    taskId: Id,
    model: Schema.optional(ModelSelection),
    runtimeMode: Schema.optional(PitbossRuntimeMode),
    resumeAttemptId: Schema.optional(Id),
  }),
  Schema.Struct({
    type: Schema.Literal("report"),
    taskId: Id,
    kind: Schema.Literals(["question", "progress"]),
    text: Text,
  }),
  Schema.Struct({
    type: Schema.Literal("submit"),
    taskId: Id,
    attemptId: Id,
    candidate: TrimmedNonEmptyString,
    criteriaVersion: Version,
    verdict: PitbossEvidence.fields.verdict,
    summary: Text,
    command: Text,
    artifactUrls: PitbossEvidence.fields.artifactUrls,
  }),
  Schema.Struct({
    type: Schema.Literal("review"),
    taskId: Id,
    attemptId: Id,
    candidate: TrimmedNonEmptyString,
    criteriaVersion: Version,
    verdict: PitbossEvidence.fields.verdict,
    summary: TrimmedNonEmptyString.check(Schema.isMaxLength(16000)),
    command: TrimmedNonEmptyString,
    artifactUrls: PitbossEvidence.fields.artifactUrls,
  }),
  Schema.Struct({
    type: Schema.Literal("accept"),
    taskId: Id,
    evidenceId: Id,
    note: TrimmedNonEmptyString,
  }),
  Schema.Struct({ type: Schema.Literal("rework"), taskId: Id, note: TrimmedNonEmptyString }),
  Schema.Struct({
    type: Schema.Literal("revise-result"),
    taskId: Id,
    note: TrimmedNonEmptyString,
    model: Schema.optional(ModelSelection),
    runtimeMode: Schema.optional(PitbossRuntimeMode),
  }),
  Schema.Struct({ type: Schema.Literal("close"), taskId: Id, reason: TrimmedNonEmptyString }),
  Schema.Struct({ type: Schema.Literal("cancel"), taskId: Id, note: Text }),
  Schema.Struct({ type: Schema.Literal("reopen"), taskId: Id }),
  Schema.Struct({ type: Schema.Literal("acknowledge"), messageId: Id }),
]);
export type PitbossAction = typeof PitbossAction.Type;
type VerificationProposalTask = Pick<
  PitbossTask,
  | "id"
  | "proposedVerificationRecipe"
  | "proposedVerificationDigest"
  | "proposedVerificationDecisionId"
  | "decisions"
>;
type VerificationProposalApprovalAction = Extract<
  PitbossAction,
  { readonly type: "approve-verification" }
>;

/** Returns an atomic action only when the task carries the complete persisted approval identity. */
export function verificationProposalApprovalAction(
  task: VerificationProposalTask,
): VerificationProposalApprovalAction | undefined {
  const recipe = task.proposedVerificationRecipe;
  const digest = task.proposedVerificationDigest;
  const decision = task.decisions?.find(
    (entry) => entry.id === task.proposedVerificationDecisionId && entry.answer === undefined,
  );
  if (!recipe || !digest || !decision) return undefined;
  return {
    type: "approve-verification",
    taskId: task.id,
    decisionId: decision.id,
    proposalVersion: recipe.version,
    proposalDigest: digest,
  };
}

/** Legacy proposals remain explicit manual saves; missing identity never becomes inferred consent. */
export function verificationProposalSaveAction(
  task: VerificationProposalTask,
): PitbossAction | undefined {
  const approval = verificationProposalApprovalAction(task);
  if (approval) return approval;
  if (task.proposedVerificationDigest || task.proposedVerificationDecisionId) return undefined;
  if (!task.proposedVerificationRecipe) return undefined;
  return {
    type: "verification-recipe",
    recipe: task.proposedVerificationRecipe,
    selectForTaskId: task.id,
  };
}
export const PitbossCommand = Schema.Struct({
  commandId: CommandId,
  expectedRevision: Version,
  authorityGeneration: Schema.optional(Version),
  action: PitbossAction,
});
export type PitbossCommand = typeof PitbossCommand.Type;
export class PitbossError extends Schema.TaggedError<PitbossError>()("PitbossError", {
  code: Schema.Literals(["conflict", "forbidden", "invalid", "unavailable"]),
  message: Schema.String,
}) {}
export const PitbossReadInput = Schema.Record(Schema.String, Schema.Never);

export const PitbossSourceConfig = Schema.Struct({
  id: Id,
  kind: Schema.Literals(["vikunja", "jira", "linear"]),
  baseUrl: TrimmedNonEmptyString,
  tenantId: Id,
  remoteProjectId: Id,
  projectId: ProjectId,
  enabled: Schema.Boolean,
});
export type PitbossSourceConfig = typeof PitbossSourceConfig.Type;
export const PitbossSourceConnection = Schema.Struct({
  config: PitbossSourceConfig,
  lastSyncAt: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type PitbossSourceConnection = typeof PitbossSourceConnection.Type;
export const PitbossSourcesResult = Schema.Struct({
  sources: Schema.Array(PitbossSourceConnection),
});
export const PitbossSourceRequest = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("configure"),
    config: PitbossSourceConfig,
    token: Schema.optional(Text),
  }),
  Schema.Struct({ type: Schema.Literal("sync"), id: Id }),
]);
export type PitbossSourceRequest = typeof PitbossSourceRequest.Type;

export type PitbossSourcesResult = typeof PitbossSourcesResult.Type;

export type PitbossTaskNextAction =
  | "setup"
  | "decision"
  | "await-writer"
  | "await-verification"
  | "verify"
  | "review"
  | "recover"
  | "accept"
  | "assign"
  | "working";

/**
 * Status records lifecycle history; this derives the concrete obligation without weakening the
 * evidence boundary. In particular, a retained result is never made assignable just because a
 * setup decision moved its task back to queued.
 */
export function pitbossTaskNextAction(
  state: PitbossSnapshot,
  task: PitbossTask,
  // Pure callers can pin observation time; UI callers use wall time for expiring observations.
  // @effect-diagnostics-next-line globalDate:off
  now = Date.now(),
): PitbossTaskNextAction | null {
  if (["done", "cancelled"].includes(task.status)) return null;
  if (task.proposedVerificationRecipe) return "setup";
  if (task.decisions?.some((decision) => decision.answer === undefined)) return "decision";
  if (task.pendingOperationId) return "working";
  const selectedRecipe = verificationRecipeForTask(state, task);
  if (task.verificationProfileId && (!selectedRecipe || selectedRecipe.enabled === false))
    return "setup";

  const attempt = task.attempts.at(-1);
  if (attempt && ["pending", "running", "submitted", "stop_requested"].includes(attempt.state))
    return attempt.state === "submitted" || attempt.state === "stop_requested"
      ? "await-writer"
      : "working";

  // Reopen preserves evidence for audit, so explicit rework intent must outrank that old result.
  // Assign consumes the intent before starting the replacement writer.
  if (task.status === "queued" && task.reworkRequestedAt) return "assign";

  const evidence = task.evidence.at(-1);
  if (evidence) {
    // A profile approval can advance the proof contract while preserving the candidate. A fresh
    // coordinator review re-attests that candidate; assigning another implementation would race
    // the retained result and lose useful work.
    if (evidence.criteriaVersion !== task.criteriaVersion) return "review";
    if (evidence.provenance === "coordinator_review" && evidence.verdict !== "pass")
      return "recover";
    const recipe = selectedRecipe;
    if (recipe && recipe.enabled !== false) {
      const run = task.verification;
      const verificationMatches =
        !!run &&
        run.candidate === evidence.candidate &&
        run.attemptId === evidence.attemptId &&
        run.criteriaVersion === task.criteriaVersion &&
        (run.recipe.profileId ?? "default") === (recipe.profileId ?? "default") &&
        run.recipe.projectId === recipe.projectId &&
        run.recipe.version === recipe.version;
      if (verificationMatches && ["pending", "running"].includes(run.state))
        return "await-verification";
      if (!hasCurrentVerification(task, recipe, evidence.candidate, now)) return "verify";
    }
    // Acceptance needs the task to still be in review. A decision or rework that moved it out
    // sends the candidate back through a fresh coordinator review rather than offering an
    // acceptance the decider would refuse.
    if (evidence.provenance === "coordinator_review" && task.status === "verifying")
      return "accept";
    return "review";
  }

  if (attempt && ["stopped", "failed"].includes(attempt.state))
    return task.status === "queued" ? "assign" : "recover";
  if (task.status === "blocked" || task.status === "verifying") return "recover";
  return task.status === "queued" ? "assign" : "working";
}

export function pitbossTaskNextActionLabel(action: PitbossTaskNextAction | null) {
  switch (action) {
    case "setup":
      return "Approve verification setup";
    case "decision":
      return "Resolve decision";
    case "await-writer":
      return "Waiting for worker to finish";
    case "await-verification":
      return "Verification in progress";
    case "verify":
      return "Run verification";
    case "review":
      return "Review retained result";
    case "recover":
      return "Recover or close";
    case "accept":
      return "Accept reviewed result";
    case "assign":
      return "Ready to assign";
    case "working":
      return "In progress";
    default:
      return null;
  }
}

/**
 * What a person reads for a message. Server-authored messages carry an explicit headline;
 * agent-authored report and submit text falls back to its own opening sentence so the board
 * never renders a paragraph where a line belongs.
 */
export function pitbossMessageHeadline(
  message: Pick<PitbossMessage, "text" | "headline">,
  maxLength = 120,
) {
  const source = message.headline?.trim() || message.text.trim();
  const firstLine = source.split("\n", 1)[0]!.trim();
  // A sentence break only shortens the line; without one the whole first line is the headline.
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(firstLine)?.[1] ?? firstLine;
  if (sentence.length <= maxLength) return sentence;
  return `${firstLine
    .slice(0, maxLength)
    .trimEnd()
    .replace(/[.,;:]$/, "")}…`;
}

/**
 * True while the task's current attempt is parked on a runtime permission prompt. Only the user can
 * answer it, so route it as user attention, never as a manager obligation.
 */
export function taskAwaitingApproval(
  task: Pick<PitbossTask, "attempts">,
  awaitingApproval: PitbossSnapshot["awaitingApproval"],
) {
  const attempt = task.attempts.at(-1);
  return !!attempt && !!awaitingApproval?.includes(attempt.id);
}

/** User attention is a concrete decision or setup review, not every operational blocker. */
function workNeedsUserInput(
  task: Pick<PitbossTask, "status" | "decisions" | "proposedVerificationRecipe">,
) {
  return (
    !["done", "cancelled"].includes(task.status) &&
    (!!task.proposedVerificationRecipe ||
      !!task.decisions?.some((decision) => decision.answer === undefined))
  );
}

/**
 * Everything the user is asked to answer: a recorded decision or setup review, plus a live worker
 * parked on a runtime permission prompt. Badges, filters and both boards read this, so the control
 * that opens "Needs you" can never hide a row that list would show.
 */
export function workNeedsYou(
  task: Pick<PitbossTask, "status" | "decisions" | "proposedVerificationRecipe" | "attempts">,
  awaitingApproval?: PitbossSnapshot["awaitingApproval"],
) {
  return workNeedsUserInput(task) || taskAwaitingApproval(task, awaitingApproval);
}

/** Worker/peer reports and submitted results belong to the coordinator's inbox. */
export function isUserWorkMessage(message: PitbossMessage) {
  return (
    !message.acknowledged &&
    !message.sourcePeerId &&
    !message.recipientLeadId &&
    (message.kind === "decision" || (!message.threadId && message.kind === "question"))
  );
}
