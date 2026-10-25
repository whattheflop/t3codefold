import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import { layerWithRegistry } from "./testkit/ProviderReplayHarness.ts";

it.effect("replays durable send receipts after completion without dispatching another run", () => {
  const instanceId = ProviderInstanceId.make("codex");
  const adapter = {
    instanceId,
    driver: ProviderDriverKind.make("codex"),
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
    openSession: () => Effect.die("Runs here never reach a provider"),
  } as ProviderAdapter.ProviderAdapterV2["Service"];
  // No effect worker: the accepted run never reaches a provider, so the test
  // completes it by writing the run event directly.
  const testLayer = ThreadManagementService.layer.pipe(
    // The same memoized database the orchestrator writes receipts to.
    Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory))),
    Layer.provide(ServerSettings.layerTest()),
    Layer.provideMerge(
      layerWithRegistry(
        { name: "thread-management-send-retry" },
        ProviderAdapterRegistry.layerFromAdapters([adapter]),
        { databaseLayer: SqlitePersistence.layerMemory, runEffectWorker: false },
      ),
    ),
  );
  return Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const service = yield* ThreadManagementService.ThreadManagementService;
    const sink = yield* EventSink.EventSinkV2;
    const projectId = ProjectId.make("project:thread-management:send-retry");
    const threadId = ThreadId.make("thread:thread-management:send-retry");
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("command:thread-management:send-retry:create"),
      threadId,
      projectId,
      title: "Retry",
      modelSelection: { instanceId, model: "gpt-5-codex" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
    const input = {
      projectId,
      threadId,
      commandId: CommandId.make("command:thread-management:send-retry:send"),
      messageId: MessageId.make("message:thread-management:send-retry"),
      text: "Continue",
      attachments: [],
      mode: "auto" as const,
      createdBy: "user" as const,
      creationSource: "web" as const,
    };
    const accepted = yield* service.sendToThread(input);
    const now = yield* DateTime.now;
    yield* sink.write({
      events: [
        {
          id: EventId.make("event:thread-management:send-retry:complete"),
          type: "run.updated",
          threadId,
          runId: accepted.run.id,
          occurredAt: now,
          payload: { ...accepted.run, status: "completed", completedAt: now },
        },
      ],
    });

    // A completed run is not steerable, so without the accepted-run lookup
    // steer and restart retries would fail before reaching the receipt.
    for (const mode of ["auto", "queue", "steer", "restart"] as const) {
      const replayed = yield* service.sendToThread({ ...input, mode });
      expect(replayed.dispatch.sequence).toBe(accepted.dispatch.sequence);
      expect(replayed.dispatch.storedEvents).toEqual(accepted.dispatch.storedEvents);
      expect(replayed.message.id).toBe(accepted.message.id);
      expect(replayed.run.id).toBe(accepted.run.id);
      expect(replayed.run.status).toBe("completed");
      expect(replayed.projection.messages).toHaveLength(1);
    }
    expect((yield* orchestrator.getThreadProjection(threadId)).runs).toHaveLength(1);

    const freshSteer = yield* service
      .sendToThread({
        ...input,
        commandId: CommandId.make("command:thread-management:send-retry:fresh-steer"),
        messageId: MessageId.make("message:thread-management:send-retry:fresh-steer"),
        mode: "steer",
      })
      .pipe(Effect.flip);
    expect(freshSteer).toBeInstanceOf(ThreadManagementService.ThreadManagementNoSteerableRunError);

    yield* orchestrator.dispatch({
      type: "thread.archive",
      commandId: CommandId.make("command:thread-management:send-retry:archive"),
      threadId,
    });
    const archivedReplay = yield* service.sendToThread({ ...input, mode: "restart" });
    expect(archivedReplay.dispatch.sequence).toBe(accepted.dispatch.sequence);

    const freshArchived = yield* service
      .sendToThread({
        ...input,
        commandId: CommandId.make("command:thread-management:send-retry:fresh-archived"),
        messageId: MessageId.make("message:thread-management:send-retry:fresh-archived"),
        mode: "restart",
      })
      .pipe(Effect.flip);
    expect(freshArchived).toBeInstanceOf(
      ThreadManagementService.ThreadManagementThreadArchivedError,
    );
  }).pipe(Effect.provide(testLayer));
});
