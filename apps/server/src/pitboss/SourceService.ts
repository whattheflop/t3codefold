import {
  PitbossError,
  PitbossSourceConfig,
  type PitbossSourceRequest,
  type PitbossSourcesResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { WorkStore } from "./WorkStore.ts";
import { readSourcePage } from "./TaskSources.ts";

const isPitbossError = Schema.is(PitbossError);
const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(PitbossSourceConfig));
const encodeConfig = Schema.encodeEffect(Schema.fromJsonString(PitbossSourceConfig));
const error = (cause: unknown) =>
  isPitbossError(cause)
    ? cause
    : new PitbossError({
        code: "unavailable",
        message: cause instanceof Error ? cause.message : "Source operation failed.",
      });
export class SourceService extends Context.Service<
  SourceService,
  {
    list: () => Effect.Effect<PitbossSourcesResult, PitbossError>;
    execute: (input: PitbossSourceRequest) => Effect.Effect<PitbossSourcesResult, PitbossError>;
  }
>()("t3/pitboss/SourceService") {}
export const layer = Layer.effect(
  SourceService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const secrets = yield* ServerSecretStore;
    const store = yield* WorkStore;
    const list = Effect.fn("SourceService.list")(function* () {
      const rows = yield* sql<{
        config_json: string;
        last_sync_at: string | null;
        error: string | null;
      }>`SELECT config_json, last_sync_at, error FROM pitboss_sources ORDER BY id`;
      return {
        sources: yield* Effect.forEach(rows, (row) =>
          Effect.gen(function* () {
            return {
              config: yield* decodeConfig(row.config_json),
              lastSyncAt: row.last_sync_at,
              error: row.error,
            };
          }),
        ),
      };
    }, Effect.mapError(error));
    const syncLock = yield* Semaphore.make(1);
    const sync = Effect.fn("SourceService.sync")(
      function* (id: string) {
        const source = (yield* list()).sources.find((entry) => entry.config.id === id);
        if (!source || !source.config.enabled)
          return yield* new PitbossError({
            code: "invalid",
            message: "Source is absent or disabled.",
          });
        const result = yield* Effect.result(
          Effect.gen(function* () {
            const secret = yield* secrets.get(`pitboss-source-${id}`);
            if (Option.isNone(secret))
              return yield* new PitbossError({
                code: "invalid",
                message: "This source needs read credentials.",
              });
            const token = new TextDecoder().decode(secret.value);
            let cursor: string | null = null;
            const cursors = new Set<string>();
            for (let page = 0; page < 10; page++) {
              const result = yield* Effect.tryPromise({
                try: () => readSourcePage(source.config, token, cursor),
                catch: error,
              });
              yield* store.importSources(source.config, result.observations);
              if (result.nextCursor === null) return;
              if (cursors.has(result.nextCursor))
                return yield* new PitbossError({
                  code: "invalid",
                  message: "Source repeated its page cursor.",
                });
              cursors.add(result.nextCursor);
              cursor = result.nextCursor;
            }
            return yield* new PitbossError({
              code: "invalid",
              message: "Source exceeds the pilot's 500-item scan. Narrow its project scope.",
            });
          }),
        );
        const now = DateTime.formatIso(yield* DateTime.now);
        if (result._tag === "Failure") {
          yield* sql`UPDATE pitboss_sources SET error = ${error(result.failure).message} WHERE id = ${id}`;
          return yield* result.failure;
        }
        yield* sql`UPDATE pitboss_sources SET last_sync_at = ${now}, error = NULL WHERE id = ${id}`;
      },
      syncLock.withPermits(1),
      Effect.mapError(error),
    );
    const execute = Effect.fn("SourceService.execute")(function* (input: PitbossSourceRequest) {
      if (input.type === "configure") {
        const config = input.config;
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(config.id))
          return yield* new PitbossError({
            code: "invalid",
            message: "Use a short source ID with letters, digits, dash or underscore.",
          });
        const state = yield* store.read();
        if (!state.role?.brief.projectIds.includes(config.projectId))
          return yield* new PitbossError({
            code: "forbidden",
            message: "Choose a project in the pitboss brief.",
          });
        if (input.token !== undefined)
          yield* secrets.set(`pitboss-source-${config.id}`, new TextEncoder().encode(input.token));
        const json = yield* encodeConfig(config);
        yield* sql`INSERT INTO pitboss_sources (id, config_json) VALUES (${config.id}, ${json}) ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json`;
      } else yield* sync(input.id);
      return yield* list();
    }, Effect.mapError(error));
    yield* Effect.gen(function* () {
      for (const source of (yield* list()).sources.filter((entry) => entry.config.enabled)) {
        yield* sync(source.config.id).pipe(Effect.ignore);
      }
    }).pipe(Effect.repeat(Schedule.spaced("60 seconds")), Effect.forkScoped);
    return SourceService.of({ list, execute });
  }),
);
