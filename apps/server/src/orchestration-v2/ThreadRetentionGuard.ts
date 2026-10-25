import type { OrchestrationV2ServerCommand } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class ThreadRetentionGuardError extends Schema.TaggedError<ThreadRetentionGuardError>()(
  "ThreadRetentionGuardError",
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.reason;
  }
}

/**
 * Lets a feature outside orchestration veto a command before it is planned, for example
 * refusing to archive a thread that must stay visible. The default allows every command.
 * The orchestrator checks it at the top of every dispatch.
 */
export class ThreadRetentionGuard extends Context.Reference<{
  readonly check: (
    command: OrchestrationV2ServerCommand,
  ) => Effect.Effect<void, ThreadRetentionGuardError>;
}>("t3/orchestration-v2/ThreadRetentionGuard", {
  defaultValue: () => ({ check: () => Effect.void }),
}) {}
