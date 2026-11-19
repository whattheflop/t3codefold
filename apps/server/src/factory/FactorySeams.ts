import {
  FactoryAgent,
  type ThreadId,
  type RunAttemptId,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { FactoryControl, factoryIsEnabled } from "./FactoryControl.ts";
import {
  ThreadActivityGuard,
  ThreadActivityGuardError,
} from "../orchestration-v2/ThreadActivityGuard.ts";
import { FactoryStore } from "./FactoryStore.ts";
import { TurnPreamble } from "../orchestration-v2/TurnPreamble.ts";
import {
  ThreadRetentionGuard,
  ThreadRetentionGuardError,
} from "../orchestration-v2/ThreadRetentionGuard.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { factoryDecisionContext } from "./decisionContext.ts";
import { FACTORY_DECISION_GUIDANCE } from "./decisionGuidance.ts";

const isThreadActivityGuardError = Schema.is(ThreadActivityGuardError);
const isThreadRetentionGuardError = Schema.is(ThreadRetentionGuardError);

const decodeAgent = Schema.decodeEffect(Schema.fromJsonString(FactoryAgent));
const factoryThreadAgent = Effect.fn("FactorySeams.threadAgent")(function* (threadId: ThreadId) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    payload_json: string;
  }>`SELECT payload_json FROM factory_agents WHERE json_extract(payload_json, '$.threadId') = ${threadId}`;
  return rows[0] ? yield* decodeAgent(rows[0].payload_json) : undefined;
});

const preamble = Layer.effect(
  TurnPreamble,
  Effect.gen(function* () {
    const store = yield* FactoryStore;
    const projection = yield* ProjectionStore.ProjectionStoreV2;
    const sql = yield* SqlClient.SqlClient;
    return {
      forAttempt: Effect.fn("FactorySeams.forAttempt")(
        (threadId: ThreadId, attemptId: RunAttemptId) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                if (!(yield* factoryIsEnabled)) return null;
                const cached = yield* sql<{
                  content: string;
                }>`SELECT content FROM factory_capsule_attempts WHERE attempt_id = ${attemptId}`;
                if (cached[0]) return cached[0].content;
                const agents = yield* store.list("agents");
                const agent = agents.find(
                  (a) => a.threadId === threadId && !["closed", "retired"].includes(a.lifecycle),
                );
                if (!agent) return null;
                const history = yield* sql<{
                  count: number;
                  marker: string | null;
                }>`SELECT COUNT(*) AS count, (SELECT marker FROM factory_capsule_attempts WHERE agent_id = ${agent.id} ORDER BY rowid DESC LIMIT 1) AS marker FROM factory_capsule_attempts WHERE agent_id = ${agent.id}`;
                const record = yield* projection.getThreadRecords(threadId, ["turnItems"], {
                  turnItemTypes: ["compaction"],
                });
                const marker = record.turnItems.at(-1)?.id ?? "";
                const count = history[0]?.count ?? 0;
                const full =
                  count === 0 || marker !== (history[0]?.marker ?? "") || count % 25 === 0;
                const context = factoryDecisionContext(
                  agent,
                  agents,
                  yield* store.list("cards"),
                  yield* store.list("wakes"),
                );
                const authority =
                  "Outward work requires answered Factory cards and factory_execute_action. Never bypass via other commands; Factory wakes are not user consent.";
                const role = full ? agent.capsule.slice(0, 1500) : `${agent.role} ${agent.id}`;
                const content = `<factory-role>\n${role}\n\n${authority}\n\n${FACTORY_DECISION_GUIDANCE}\n\n${context}\n</factory-role>`;
                yield* sql`INSERT INTO factory_capsule_attempts (attempt_id, agent_id, content, marker) VALUES (${attemptId}, ${agent.id}, ${content}, ${marker})`;
                return content;
              }),
            )
            .pipe(
              Effect.provideService(SqlClient.SqlClient, sql),
              Effect.orElseSucceed(() => null),
            ),
      ),
    };
  }),
);

const retention = Layer.effect(
  ThreadRetentionGuard,
  Effect.gen(function* () {
    const store = yield* FactoryStore;
    const sql = yield* SqlClient.SqlClient;
    return {
      check: Effect.fn("FactorySeams.checkRetention")(
        function* (command: OrchestrationV2ServerCommand) {
          if (!(yield* factoryIsEnabled)) return;
          if (
            command.type !== "thread.delete" &&
            command.type !== "thread.archive" &&
            command.type !== "thread.unpin"
          )
            return;
          const agent = (yield* store.list("agents")).find(
            (a) =>
              a.threadId === command.threadId &&
              a.role === "commander" &&
              !["closed", "retired"].includes(a.lifecycle),
          );
          if (agent)
            return yield* new ThreadRetentionGuardError({
              reason:
                "The active Factory Commander must remain pinned and available. Hand it over before removing it.",
            });
        },
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.mapError((cause) =>
          isThreadRetentionGuardError(cause)
            ? cause
            : new ThreadRetentionGuardError({
                reason: "Factory retention state is unavailable.",
                cause,
              }),
        ),
      ),
    };
  }),
);

const activity = Layer.effect(
  ThreadActivityGuard,
  Effect.gen(function* () {
    const control = yield* FactoryControl;
    const sql = yield* SqlClient.SqlClient;
    const check = Effect.fn("FactorySeams.checkActivity")(
      function* (threadId: ThreadId) {
        const agent = yield* factoryThreadAgent(threadId);
        if (
          agent &&
          (!(yield* factoryIsEnabled) || ["closed", "retired"].includes(agent.lifecycle))
        )
          return yield* new ThreadActivityGuardError({
            reason: "Factory is disabled or this agent is closed.",
          });
      },
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.mapError((cause) =>
        isThreadActivityGuardError(cause)
          ? cause
          : new ThreadActivityGuardError({
              reason: "Factory activity state is unavailable.",
              cause,
            }),
      ),
    );
    const admit = Effect.fn("FactorySeams.admitActivity")(function* <A, E, R>(
      threadId: ThreadId,
      work: Effect.Effect<A, E, R>,
    ) {
      const agent = yield* factoryThreadAgent(threadId).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.mapError(
          (cause) =>
            new ThreadActivityGuardError({
              reason: "Factory activity state is unavailable.",
              cause,
            }),
        ),
      );
      if (!agent) return yield* work;
      if (["closed", "retired"].includes(agent.lifecycle))
        return yield* new ThreadActivityGuardError({ reason: "This Factory agent is closed." });
      const result = yield* control.admit(Effect.result(work)).pipe(
        Effect.mapError(
          (cause) =>
            new ThreadActivityGuardError({
              reason: "Factory is disabled on this server.",
              cause,
            }),
        ),
      );
      if (result._tag === "Failure") return yield* Effect.fail(result.failure);
      return result.success;
    });
    return { check, admit };
  }),
);

export const layer = Layer.mergeAll(preamble, retention, activity);
