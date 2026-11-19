import { FactoryError, type FactoryExecution } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FactoryControl } from "./FactoryControl.ts";
import { FactoryStore } from "./FactoryStore.ts";
import { canonicalAction } from "./FactoryDecisions.ts";
import { callerAgent, type FactoryActor } from "./access.ts";
import * as Processes from "../processRunner.ts";
import * as Projects from "../project/ProjectService.ts";

const decodeMergeResult = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ merged: Schema.Boolean })),
);
export function factoryActionOutcome(
  kind: string,
  result: Processes.ProcessRunOutput,
): "succeeded" | "failed" | "unknown" {
  if (result.code !== 0 || result.timedOut || result.stdoutTruncated || result.stdoutInvalidUtf8)
    return "unknown";
  if (kind !== "merge") return "succeeded";
  const response = decodeMergeResult(result.stdout);
  return Option.isNone(response) ? "unknown" : response.value.merged ? "succeeded" : "failed";
}

export class FactoryActions extends Context.Service<
  FactoryActions,
  {
    readonly execute: (
      actor: FactoryActor,
      cardId: string,
    ) => Effect.Effect<FactoryExecution, FactoryError>;
    readonly recover: Effect.Effect<void, FactoryError>;
  }
>()("t3/factory/FactoryActions") {}

const make = Effect.gen(function* () {
  const store = yield* FactoryStore;
  const control = yield* FactoryControl;
  const runner = yield* Processes.ProcessRunner;
  const projects = yield* Projects.ProjectService;
  const fs = yield* FileSystem.FileSystem;
  const digests = yield* Digest.Digest;
  const hash = Effect.fn("FactoryActions.hash")((text: string) =>
    digests.digestHex(Digest.sha256, new TextEncoder().encode(text)),
  );
  const execute: FactoryActions["Service"]["execute"] = Effect.fn("FactoryActions.execute")(
    function* (actor, cardId) {
      yield* control.requireEnabled;
      const owner = yield* callerAgent(actor).pipe(Effect.provideService(FactoryStore, store));
      const reserved = yield* store.transaction(
        Effect.gen(function* () {
          const card = yield* store.get("cards", cardId);
          if (!card) return yield* new FactoryError({ code: "not-found", entityId: cardId });
          if (card.ownerId !== owner.id) return yield* new FactoryError({ code: "forbidden" });
          const action = card.body.action;
          if (
            !action ||
            !["answered", "acked"].includes(card.state) ||
            !["CHOSE", "CHOSE-against", "DEFAULTED"].includes(card.outcome ?? "") ||
            card.optionId !== action.optionId
          )
            return yield* new FactoryError({ code: "invalid", entityId: cardId });
          const payload = yield* store.get("payloads", action.payloadSha256);
          if (
            !payload ||
            payload.ownerId !== card.authorId ||
            (yield* hash(canonicalAction(payload.envelope))) !== action.payloadSha256
          )
            return yield* new FactoryError({ code: "invalid", entityId: cardId });
          const executionId = `exec:${yield* hash(`${card.id}:${card.revision}:${card.optionId}:${action.payloadSha256}`)}`;
          const existing = yield* store.get("executions", executionId);
          if (existing)
            return {
              execution: existing,
              envelope: payload.envelope,
              launch: existing.state === "claimed",
            };
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          if (card.answeredAt === null || now - card.answeredAt >= 86_400_000)
            return yield* new FactoryError({ code: "invalid", entityId: cardId });
          const execution = yield* store.put("executions", {
            id: executionId,
            version: 0,
            createdAt: now,
            updatedAt: now,
            cardId: card.id,
            cardRevision: card.revision,
            optionId: card.optionId!,
            payloadSha256: action.payloadSha256,
            state: "claimed",
            result: "",
          });
          return { execution, envelope: payload.envelope, launch: true };
        }),
      );
      if (!reserved.launch) return reserved.execution;
      const envelope = reserved.envelope;
      const invalid = () => new FactoryError({ code: "invalid", entityId: cardId });
      if (
        envelope.kind !== envelope.request.type ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(envelope.repository)
      )
        return yield* invalid();
      const project = yield* projects
        .getById(owner.projectId)
        .pipe(Effect.mapError((cause) => new FactoryError({ code: "unavailable", cause })));
      if (project._tag === "None") return yield* invalid();
      const cwd = yield* fs
        .realPath(envelope.cwd)
        .pipe(Effect.mapError((cause) => new FactoryError({ code: "invalid", cause })));
      const root = yield* fs
        .realPath(project.value.workspaceRoot)
        .pipe(Effect.mapError((cause) => new FactoryError({ code: "invalid", cause })));
      if (cwd !== root) {
        const worktrees = yield* runner
          .run({ command: "git", args: ["worktree", "list", "--porcelain"], cwd: root })
          .pipe(Effect.mapError((cause) => new FactoryError({ code: "invalid", cause })));
        if (!worktrees.stdout.split("\n").includes(`worktree ${cwd}`)) return yield* invalid();
      }
      const request = envelope.request;
      const api = `repos/${envelope.repository}`;
      let command = "gh";
      let args: string[];
      switch (request.type) {
        case "merge":
          if (
            !/^[a-f0-9]{40,64}$/i.test(request.approvedHeadSha) ||
            !Number.isSafeInteger(request.prNumber) ||
            request.prNumber < 1
          )
            return yield* invalid();
          args = [
            "api",
            "--method",
            "PUT",
            `${api}/pulls/${request.prNumber}/merge`,
            "--raw-field",
            `sha=${request.approvedHeadSha}`,
            "--raw-field",
            `merge_method=${request.method}`,
          ];
          break;
        case "open-pr":
          args = [
            "api",
            "--method",
            "POST",
            `${api}/pulls`,
            "--raw-field",
            `head=${request.head}`,
            "--raw-field",
            `base=${request.base}`,
            "--raw-field",
            `title=${request.title}`,
            "--raw-field",
            `body=${request.body}`,
            "--field",
            `draft=${request.draft}`,
          ];
          break;
        case "external-post":
          if (!Number.isSafeInteger(request.issueNumber) || request.issueNumber < 1)
            return yield* invalid();
          args = [
            "api",
            "--method",
            "POST",
            `${api}/issues/${request.issueNumber}/comments`,
            "--raw-field",
            `body=${request.body}`,
          ];
          break;
        case "force-push":
        case "delete-branch": {
          if (
            !request.destinationRef.startsWith("refs/heads/") ||
            !/^[a-f0-9]{40,64}$/i.test(request.expectedOldOid) ||
            (request.type === "force-push" && !/^[a-f0-9]{40,64}$/i.test(request.newOid))
          )
            return yield* invalid();
          const validRef = yield* runner
            .run({ command: "git", args: ["check-ref-format", request.destinationRef], cwd })
            .pipe(Effect.mapError((cause) => new FactoryError({ code: "invalid", cause })));
          if (validRef.code !== 0) return yield* invalid();
          command = "git";
          args = [
            "push",
            `--force-with-lease=${request.destinationRef}:${request.expectedOldOid}`,
            `https://github.com/${envelope.repository}.git`,
            `${request.type === "force-push" ? request.newOid : ""}:${request.destinationRef}`,
          ];
        }
      }
      const executing = yield* store.transaction(
        Effect.gen(function* () {
          yield* control.requireEnabled;
          const latest = yield* store.get("executions", reserved.execution.id);
          const card = yield* store.get("cards", cardId);
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          if (
            !latest ||
            latest.state !== "claimed" ||
            !card ||
            !["answered", "acked"].includes(card.state) ||
            card.revision !== latest.cardRevision ||
            card.answeredAt === null ||
            now - card.answeredAt >= 86_400_000
          )
            return yield* new FactoryError({ code: "conflict", entityId: cardId });
          return yield* store.put("executions", { ...latest, state: "executing", updatedAt: now });
        }),
      );
      const result = yield* runner
        .run({
          command,
          args,
          cwd,
          timeout: "2 minutes",
          maxOutputBytes: 16_384,
          outputMode: "truncate",
        })
        .pipe(Effect.result);
      return yield* store.transaction(
        Effect.gen(function* () {
          const latest = yield* store.get("executions", executing.id);
          if (!latest)
            return yield* new FactoryError({ code: "not-found", entityId: executing.id });
          // A process/transport failure cannot prove the host did not apply the action.
          return yield* store.put("executions", {
            ...latest,
            updatedAt: DateTime.toEpochMillis(yield* DateTime.now),
            state:
              result._tag === "Failure"
                ? "unknown"
                : factoryActionOutcome(envelope.kind, result.success),
            result:
              result._tag === "Failure"
                ? "External outcome unknown; reconcile on the host before any new action."
                : `${result.success.stdout}\n${result.success.stderr}`.slice(0, 16_384),
          });
        }),
      );
    },
  );
  const recover = store.transaction(
    Effect.gen(function* () {
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      for (const execution of yield* store.list("executions"))
        if (execution.state === "executing")
          yield* store.put("executions", {
            ...execution,
            state: "unknown",
            updatedAt: now,
            result:
              "Server restarted during external execution. Verify the host result; automatic retry is blocked.",
          });
    }),
  );
  return FactoryActions.of({ execute, recover });
});
export const layer = Layer.effect(FactoryActions, make);
