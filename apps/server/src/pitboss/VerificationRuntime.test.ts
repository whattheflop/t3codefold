import { expect, it } from "@effect/vitest";
import { CommandId, EnvironmentId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ProjectRow, ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { WorkStore, layer as storeLayer } from "./WorkStore.ts";
import { VerificationRunner } from "./VerificationRunner.ts";
import { layer as runtime } from "./VerificationRuntime.ts";
import { fixture } from "./Verification.testkit.ts";
import { interruptedReceipt } from "./Verification.ts";

const decodeProject = Schema.decodeUnknownEffect(ProjectRow);
it.effect.each([
  { mode: "commit", interrupted: false },
  { mode: "commit", interrupted: true },
  { mode: "artifact", interrupted: false },
  { mode: "observation", interrupted: true },
] as const)(
  "$mode: a restart mid-run records inconclusive (interrupted=$interrupted), otherwise resume runs once",
  ({ mode, interrupted }) =>
    Effect.gen(function* () {
      const store = yield* WorkStore;
      const sql = yield* SqlClient.SqlClient;
      const f = fixture();
      if (mode !== "commit") {
        f.act({
          type: "verification-recipe",
          recipe: {
            ...f.recipe,
            version: 2,
            mode,
            inputPath: "input.json",
            ...(mode === "observation"
              ? {
                  target: "fixture-service",
                  environmentId: EnvironmentId.make("fixture"),
                  effects: "observe",
                  maxAgeSeconds: 60,
                }
              : {}),
          },
        });
        const task = f.state.tasks[0]!;
        f.act({
          type: "review",
          taskId: task.id,
          attemptId: task.attempts[0]!.id,
          criteriaVersion: task.criteriaVersion,
          candidate:
            mode === "artifact" ? `sha256:${"b".repeat(64)}` : "observation:fixture-service",
          verdict: "pass",
          summary: "Fixture candidate",
          command: "inspect",
          artifactUrls: [],
        });
      }
      f.act({
        type: "verify",
        taskId: "task",
        evidenceId: f.state.tasks[0]!.evidence.at(-1)!.id,
      });
      for (const [index, entry] of f.history.entries())
        yield* sql`INSERT INTO pitboss_events (operation_id, request_json, payload_json, created_at) VALUES (${`seed-${index}`}, 'seed', ${entry}, '2026-09-13T00:00:00Z')`;
      yield* store.rebuild();
      yield* store.updateAttempt(
        "task",
        f.state.tasks[0]!.attempts[0]!.id,
        "stopped",
        "Retained files",
        "/retained-worker",
      );
      if (interrupted)
        yield* store.recordVerification("task", {
          ...f.state.tasks[0]!.verification!,
          state: "running",
        });
      else
        yield* store.command(
          {
            commandId: CommandId.make("pause"),
            expectedRevision: (yield* store.read()).revision,
            action: { type: "pause", paused: true },
          },
          { type: "user" },
        );
      let calls = 0;
      const project = yield* decodeProject({
        projectId: "project",
        title: "Fixture",
        hasCustomTitle: false,
        pinnedAt: null,
        archivedAt: null,
        workspaceRoot: "/fixture",
        defaultModelSelection: null,
        defaultThreadEnvMode: null,
        autoPull: false,
        faviconPath: null,
        projectIcon: null,
        scripts: [],
        createdAt: "2026-09-13T00:00:00Z",
        updatedAt: "2026-09-13T00:00:00Z",
        deletedAt: null,
      });
      yield* Layer.build(
        runtime.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(WorkStore, store),
              Layer.mock(ProjectStoreV2, {
                get: () => Effect.succeedSome(project),
              }),
              Layer.succeed(VerificationRunner, {
                run: ({ root }) =>
                  Effect.sync(() => {
                    calls++;
                    expect(root).toBe(mode === "artifact" ? "/retained-worker" : "/fixture");
                    return { ...interruptedReceipt("Captured"), verdict: "pass" as const };
                  }),
              }),
            ),
          ),
        ),
      );
      if (!interrupted) {
        expect((yield* store.read()).tasks[0]!.verification!.state).toBe("pending");
        expect(calls).toBe(0);
        yield* store.command(
          {
            commandId: CommandId.make("resume"),
            expectedRevision: (yield* store.read()).revision,
            action: { type: "pause", paused: false },
          },
          { type: "user" },
        );
      }
      const completed = yield* store.subscribe().pipe(
        Stream.filter((state) => state.tasks[0]!.verification?.state === "completed"),
        Stream.runHead,
      );
      expect(Option.isSome(completed)).toBe(true);
      expect(calls).toBe(interrupted ? 0 : 1);
      expect((yield* store.read()).tasks[0]!.verification!.receipt?.verdict).toBe(
        interrupted ? "inconclusive" : "pass",
      );
      expect(yield* store.rebuild()).toEqual(yield* store.read());
    }).pipe(
      Effect.provide(
        storeLayer.pipe(
          Layer.provideMerge(SqlitePersistence.layerMemory),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
);

it.effect("acts on a change that lands while startup is still reading the store", () =>
  Effect.gen(function* () {
    const store = yield* WorkStore;
    const sql = yield* SqlClient.SqlClient;
    const f = fixture();
    f.act({ type: "verify", taskId: "task", evidenceId: f.state.tasks[0]!.evidence.at(-1)!.id });
    for (const [index, entry] of f.history.entries())
      yield* sql`INSERT INTO pitboss_events (operation_id, request_json, payload_json, created_at) VALUES (${`seed-${index}`}, 'seed', ${entry}, '2026-09-13T00:00:00Z')`;
    yield* store.rebuild();
    yield* store.updateAttempt(
      "task",
      f.state.tasks[0]!.attempts[0]!.id,
      "stopped",
      "Retained files",
      "/retained-worker",
    );
    const setPaused = (paused: boolean) =>
      Effect.flatMap(store.read(), (state) =>
        store.command(
          {
            commandId: CommandId.make(paused ? "pause" : "resume"),
            expectedRevision: state.revision,
            action: { type: "pause", paused },
          },
          { type: "user" },
        ),
      );
    yield* setPaused(true);
    const project = yield* decodeProject({
      projectId: "project",
      title: "Fixture",
      hasCustomTitle: false,
      pinnedAt: null,
      archivedAt: null,
      workspaceRoot: "/fixture",
      defaultModelSelection: null,
      defaultThreadEnvMode: null,
      autoPull: false,
      faviconPath: null,
      projectIcon: null,
      scripts: [],
      createdAt: "2026-09-13T00:00:00Z",
      updatedAt: "2026-09-13T00:00:00Z",
      deletedAt: null,
    });
    const log: Array<"subscribe" | "read"> = [];
    let calls = 0;
    // The first drain reads a paused board; the user resumes right after that read, before the
    // drain returns. Only a subscription taken before startup reads can observe that resume.
    const racingStore: WorkStore["Service"] = {
      ...store,
      subscribeChanges: Effect.suspend(() => {
        log.push("subscribe");
        return store.subscribeChanges;
      }),
      read: (actor) =>
        store.read(actor).pipe(
          Effect.tap(() => {
            log.push("read");
            return log.filter((entry) => entry === "read").length === 2
              ? setPaused(false)
              : Effect.void;
          }),
        ),
    };
    yield* Layer.build(
      runtime.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(WorkStore, racingStore),
            Layer.mock(ProjectStoreV2, { get: () => Effect.succeedSome(project) }),
            Layer.succeed(VerificationRunner, {
              run: () =>
                Effect.sync(() => {
                  calls++;
                  return { ...interruptedReceipt("Captured"), verdict: "pass" as const };
                }),
            }),
          ),
        ),
      ),
    );
    const completed = yield* store.subscribe().pipe(
      Stream.filter((state) => state.tasks[0]!.verification?.state === "completed"),
      Stream.runHead,
    );
    expect(log[0]).toBe("subscribe");
    expect(Option.isSome(completed)).toBe(true);
    expect(calls).toBe(1);
  }).pipe(
    Effect.provide(
      storeLayer.pipe(
        Layer.provideMerge(SqlitePersistence.layerMemory),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
);
