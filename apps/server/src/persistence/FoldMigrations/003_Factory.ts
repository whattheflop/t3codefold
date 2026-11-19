import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE factory_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL, entity_id TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at INTEGER NOT NULL
  )`;
  for (const table of [
    "factory_agents",
    "factory_cards",
    "factory_card_payloads",
    "factory_wakes",
    "factory_delivery_sources",
    "factory_wake_deliveries",
    "factory_triggers",
    "factory_trigger_runs",
    "factory_trigger_items",
    "factory_spawn_requests",
    "factory_action_executions",
    "factory_lane_jobs",
    "factory_stall_episodes",
    "factory_notification_attempts",
  ]) {
    yield* sql.unsafe(
      `CREATE TABLE ${table} (id TEXT PRIMARY KEY, version INTEGER NOT NULL, payload_json TEXT NOT NULL)`,
    );
  }
  yield* sql`CREATE UNIQUE INDEX factory_agent_thread ON factory_agents(json_extract(payload_json, '$.threadId'))`;
  yield* sql`CREATE UNIQUE INDEX factory_active_commander ON factory_agents(json_extract(payload_json, '$.environmentId'))
    WHERE json_extract(payload_json, '$.role') = 'commander' AND json_extract(payload_json, '$.lifecycle') IN ('launching', 'active', 'parked')`;
  yield* sql`CREATE INDEX factory_agent_parent ON factory_agents(json_extract(payload_json, '$.parentId'))`;
  yield* sql`CREATE INDEX factory_card_owner ON factory_cards(json_extract(payload_json, '$.ownerId'), json_extract(payload_json, '$.state'))`;
  yield* sql`CREATE INDEX factory_wake_target ON factory_wakes(json_extract(payload_json, '$.targetId'), json_extract(payload_json, '$.state'))`;
  yield* sql`CREATE INDEX factory_job_root ON factory_lane_jobs(json_extract(payload_json, '$.gitRoot'), json_extract(payload_json, '$.state'))`;
  yield* sql`CREATE TABLE factory_checkpoints (id INTEGER PRIMARY KEY CHECK (id = 1), sequence INTEGER NOT NULL, payload_json TEXT NOT NULL)`;
  yield* sql`CREATE TABLE factory_tombstones (kind TEXT NOT NULL, entity_id TEXT NOT NULL, purged_at INTEGER NOT NULL, PRIMARY KEY(kind, entity_id))`;
  yield* sql`CREATE TABLE factory_capsule_attempts (attempt_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, content TEXT NOT NULL, marker TEXT NOT NULL)`;
});
