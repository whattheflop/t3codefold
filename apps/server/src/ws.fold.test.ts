import { expect, it } from "@effect/vitest";
import {
  AuthSessionId,
  CommandId,
  PitbossError,
  ProjectId,
  ProviderInstanceId,
  ProviderRealtimeVoiceError,
  ThreadId,
  WS_METHODS,
  type PitbossBrief,
  type PitbossCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { FleetBroker } from "./mcp/FleetBroker.ts";
import { FleetExecutor } from "./mcp/FleetExecutor.ts";
import { FleetRouter } from "./mcp/FleetRouter.ts";
import { OrchestratorProjectionError } from "./orchestration-v2/Orchestrator.ts";
import { ProviderSessionManagerV2 } from "./orchestration-v2/ProviderSessionManager.ts";
import {
  ThreadManagementService,
  ThreadManagementThreadNotFoundError,
} from "./orchestration-v2/ThreadManagementService.ts";
import { emptyWork } from "./pitboss/Work.ts";
import { PeerService } from "./pitboss/PeerService.ts";
import { SourceService } from "./pitboss/SourceService.ts";
import { WorkStore } from "./pitboss/WorkStore.ts";
import { makeFoldWsHandlers } from "./foldWs.ts";

const projectId = ProjectId.make("tools");
const threadId = ThreadId.make("missing");
const brief: PitbossBrief = {
  priorities: "Tools reliability",
  quality: "Prove behavior",
  projectIds: [projectId],
  maxWorkers: 1,
  maxAttempts: 3,
  workerModel: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
};
const command = (action: PitbossCommand["action"]): PitbossCommand => ({
  commandId: CommandId.make("command"),
  expectedRevision: 0,
  action,
});

const services = (input: {
  readonly workCommands: Array<PitbossCommand>;
  readonly threads: Partial<ThreadManagementService["Service"]>;
}) =>
  Layer.mergeAll(
    Layer.mock(WorkStore, {
      command: (pitboss) => {
        input.workCommands.push(pitboss);
        return Effect.succeed(emptyWork);
      },
    }),
    Layer.mock(PeerService, {}),
    Layer.mock(SourceService, {}),
    Layer.mock(FleetBroker, {}),
    Layer.mock(FleetRouter, {}),
    Layer.mock(FleetExecutor, {}),
    Layer.mock(ThreadManagementService, input.threads),
    Layer.mock(ProviderSessionManagerV2, {}),
  );

const handlers = (openedHomes: Array<PitbossCommand>) =>
  makeFoldWsHandlers({
    sessionId: AuthSessionId.make("session"),
    openGladosHome: (pitboss) => {
      openedHomes.push(pitboss);
      return Effect.succeed(emptyWork);
    },
  });

it.effect("refuses to elect a thread that is not in the project", () => {
  const workCommands: Array<PitbossCommand> = [];
  return Effect.gen(function* () {
    const fold = yield* handlers([]);
    const error = yield* Effect.flip(
      fold[WS_METHODS.pitbossCommand](command({ type: "elect", threadId, projectId, brief })),
    );
    expect(error).toBeInstanceOf(PitbossError);
    expect(error.code).toBe("invalid");
    expect(workCommands).toEqual([]);
  }).pipe(
    Effect.provide(
      services({
        workCommands,
        threads: {
          getProjectThreadRecords: () =>
            Effect.fail(new ThreadManagementThreadNotFoundError({ projectId, threadId })),
        },
      }),
    ),
  );
});

it.effect("opens the GLaDOS home instead of journaling home requests", () => {
  const workCommands: Array<PitbossCommand> = [];
  const openedHomes: Array<PitbossCommand> = [];
  return Effect.gen(function* () {
    const fold = yield* handlers(openedHomes);
    yield* fold[WS_METHODS.pitbossCommand](command({ type: "activate-home", brief }));
    yield* fold[WS_METHODS.pitbossCommand](command({ type: "reset" }));
    expect(openedHomes.map((home) => home.action.type)).toEqual(["activate-home", "reset"]);
    expect(workCommands).toEqual([]);
  }).pipe(Effect.provide(services({ workCommands, threads: {} })));
});

it.effect("reports voice failures as typed voice errors for the operation", () =>
  Effect.gen(function* () {
    const fold = yield* handlers([]);
    const start = yield* Effect.flip(
      fold[WS_METHODS.providerRealtimeVoiceStart]({ threadId, sdp: "v=0" }),
    );
    const stop = yield* Effect.flip(fold[WS_METHODS.providerRealtimeVoiceStop]({ threadId }));
    expect(start).toEqual(new ProviderRealtimeVoiceError({ threadId, operation: "start" }));
    expect(stop).toEqual(new ProviderRealtimeVoiceError({ threadId, operation: "stop" }));
  }).pipe(
    Effect.provide(
      services({
        workCommands: [],
        threads: {
          getThreadProjection: (id) =>
            Effect.fail(new OrchestratorProjectionError({ threadId: id })),
        },
      }),
    ),
  ),
);
