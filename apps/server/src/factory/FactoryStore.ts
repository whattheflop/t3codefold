import {
  FactoryError,
  FactorySchemas,
  type FactoryEntityKind,
  type FactoryEntityMap,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

const isFactoryError = Schema.is(FactoryError);

const tables = {
  control: "factory_control",
  agents: "factory_agents",
  cards: "factory_cards",
  payloads: "factory_card_payloads",
  wakes: "factory_wakes",
  sources: "factory_delivery_sources",
  deliveries: "factory_wake_deliveries",
  triggers: "factory_triggers",
  runs: "factory_trigger_runs",
  items: "factory_trigger_items",
  spawns: "factory_spawn_requests",
  executions: "factory_action_executions",
  jobs: "factory_lane_jobs",
  stalls: "factory_stall_episodes",
  notifications: "factory_notification_attempts",
} as const satisfies Record<FactoryEntityKind, string>;

export class FactoryStore extends Context.Service<
  FactoryStore,
  {
    readonly get: <K extends FactoryEntityKind>(
      kind: K,
      id: string,
    ) => Effect.Effect<FactoryEntityMap[K] | undefined, FactoryError>;
    readonly list: <K extends FactoryEntityKind>(
      kind: K,
    ) => Effect.Effect<ReadonlyArray<FactoryEntityMap[K]>, FactoryError>;
    readonly put: <K extends FactoryEntityKind>(
      kind: K,
      entity: FactoryEntityMap[K],
    ) => Effect.Effect<FactoryEntityMap[K], FactoryError>;
    readonly remove: (
      kind: FactoryEntityKind,
      id: string,
      now: number,
    ) => Effect.Effect<void, FactoryError>;
    readonly transaction: <A, R>(
      work: Effect.Effect<A, FactoryError, R>,
    ) => Effect.Effect<A, FactoryError, R>;
    readonly sequence: Effect.Effect<number, FactoryError>;
    readonly changes: Stream.Stream<void>;
    readonly subscribe: Effect.Effect<Stream.Stream<void>, never, Scope.Scope>;
  }
>()("t3/factory/FactoryStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.unbounded<void>();
  const codec = <K extends FactoryEntityKind>(kind: K) =>
    Schema.fromJsonString(
      FactorySchemas[kind] as unknown as Schema.Codec<FactoryEntityMap[K], unknown>,
    );
  const decode = <K extends FactoryEntityKind>(kind: K, json: string): FactoryEntityMap[K] =>
    Schema.decodeSync(codec(kind))(json);
  const storage = (cause: unknown) => new FactoryError({ code: "storage", cause });
  const get = Effect.fn("FactoryStore.get")(function* <K extends FactoryEntityKind>(
    kind: K,
    id: string,
  ) {
    const rows = yield* sql
      .unsafe<{ payload_json: string }>(`SELECT payload_json FROM ${tables[kind]} WHERE id = ?`, [
        id,
      ])
      .pipe(Effect.mapError(storage));
    return rows[0] === undefined
      ? undefined
      : yield* Effect.try({ try: () => decode(kind, rows[0]!.payload_json), catch: storage });
  });
  const list = Effect.fn("FactoryStore.list")(function* <K extends FactoryEntityKind>(kind: K) {
    const rows = yield* sql
      .unsafe<{ payload_json: string }>(`SELECT payload_json FROM ${tables[kind]} ORDER BY id`)
      .pipe(Effect.mapError(storage));
    return yield* Effect.try({
      try: () => rows.map((row) => decode(kind, row.payload_json)),
      catch: storage,
    });
  });
  const put = Effect.fn("FactoryStore.put")(function* <K extends FactoryEntityKind>(
    kind: K,
    entity: FactoryEntityMap[K],
  ) {
    const next = { ...entity, version: entity.version + 1 };
    const payload = yield* Schema.encodeEffect(codec(kind))(next as FactoryEntityMap[K]).pipe(
      Effect.mapError(storage),
    );
    const statement =
      entity.version === 0
        ? `INSERT INTO ${tables[kind]} (id, version, payload_json) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING version`
        : `UPDATE ${tables[kind]} SET version = ?, payload_json = ? WHERE id = ? AND version = ? RETURNING version`;
    const params =
      entity.version === 0
        ? [entity.id, next.version, payload]
        : [next.version, payload, entity.id, entity.version];
    const rows = yield* sql
      .unsafe<{ version: number }>(statement, params)
      .pipe(Effect.mapError(storage));
    if (rows.length !== 1)
      return yield* new FactoryError({ code: "conflict", entityId: entity.id });
    yield* sql`INSERT INTO factory_events (kind, entity_id, payload_json, occurred_at) VALUES (${kind}, ${entity.id}, ${payload}, ${entity.updatedAt})`.pipe(
      Effect.mapError(storage),
    );
    return next as FactoryEntityMap[K];
  });
  const remove = Effect.fn("FactoryStore.remove")(function* (
    kind: FactoryEntityKind,
    id: string,
    now: number,
  ) {
    yield* sql.unsafe(`DELETE FROM ${tables[kind]} WHERE id = ?`, [id]);
    yield* sql`INSERT OR REPLACE INTO factory_tombstones (kind, entity_id, purged_at) VALUES (${kind}, ${id}, ${now})`;
  }, Effect.mapError(storage));
  const transaction: FactoryStore["Service"]["transaction"] = Effect.fn("FactoryStore.transaction")(
    <A, R>(work: Effect.Effect<A, FactoryError, R>) =>
      sql.withTransaction(work).pipe(
        Effect.mapError((cause) => (isFactoryError(cause) ? cause : storage(cause))),
        Effect.tap(() => PubSub.publish(changes, undefined)),
      ),
  );
  return FactoryStore.of({
    get,
    list,
    put,
    remove,
    transaction,
    sequence: sql<{
      sequence: number;
    }>`SELECT COALESCE(MAX(sequence), 0) AS sequence FROM factory_events`.pipe(
      Effect.map((rows) => rows[0]?.sequence ?? 0),
      Effect.mapError(storage),
    ),
    changes: Stream.fromPubSub(changes),
    subscribe: Effect.map(PubSub.subscribe(changes), Stream.fromSubscription),
  });
});

export const layer = Layer.effect(FactoryStore, make);
