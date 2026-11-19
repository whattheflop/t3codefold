import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Fork migrations 062_Pitboss, 063_PitbossPeers and 064_PitbossMail, combined. The DDL is
// byte-identical so a fork database imported by importFoldDatabase gets the same tables.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE pitboss_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload_json TEXT NOT NULL)`;
  yield* sql`CREATE TABLE pitboss_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL UNIQUE,
    request_json TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE pitboss_effects (
    operation_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT
  )`;
  yield* sql`CREATE INDEX pitboss_effects_pending ON pitboss_effects(state)`;
  yield* sql`CREATE TABLE pitboss_sources (id TEXT PRIMARY KEY, config_json TEXT NOT NULL, last_sync_at TEXT, error TEXT)`;
  yield* sql`CREATE TABLE pitboss_context_packets (
    packet_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, revision INTEGER NOT NULL,
    content TEXT NOT NULL, created_at TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE pitboss_peers (id TEXT PRIMARY KEY, config_json TEXT NOT NULL, view_json TEXT NOT NULL, last_seen_at TEXT, error TEXT)`;
  yield* sql`CREATE TABLE pitboss_mail (peer_id TEXT NOT NULL, direction TEXT NOT NULL, message_id TEXT NOT NULL, payload_json TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(peer_id, direction, message_id))`;
});
