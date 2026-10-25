// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionMaintenance from "../orchestration-v2/ProjectionMaintenance.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import PitbossMigration from "./FoldMigrations/001_Pitboss.ts";
import { foldMigrationEntries } from "./FoldMigrations.ts";
import * as SqlitePersistence from "./Sqlite.ts";
import { migrationManifest, runMigrations } from "./Migrations.ts";
import OrchestrationV2Migration from "./Migrations/055_OrchestrationV2.ts";
import { classifyLedger, importFoldDatabase } from "./importFoldDatabase.ts";

const FORK_LEDGER = [
  "OrchestrationV2",
  "OrchestrationV2Subagents",
  "OrchestrationV2Foundation",
  "OrchestrationV2ProviderSessionBindings",
  "OrchestrationV2ThreadLaunchWorkflows",
  "ApplicationEventSource",
  "OrchestrationV2EffectCancellation",
  "ScheduledTasks",
  "LegacyV1ImportState",
  "ApplicationEventSequenceIndexes",
  "OrchestrationV2RecoveryIndexes",
  "OrchestrationV2ShellIndexes",
  "Pitboss",
  "PitbossPeers",
  "PitbossMail",
  "ProjectionThreadMessageContext",
  "ProjectionThreadTitleState",
  "PullRequestFilesViewed",
  "ProjectionThreadPullRequests",
  "ProjectionThreadsAutoSettleDisabledAt",
].map((name, index) => ({ migration_id: 50 + index, name }));

const upstreamLedger = migrationManifest.map(([migration_id, name]) => ({ migration_id, name }));

const threadId = ThreadId.make("thread:fold-import");

const makeThread = (now: DateTime.Utc): OrchestrationV2AppThread => ({
  createdBy: "user",
  creationSource: "web",
  id: threadId,
  projectId: ProjectId.make("project:fold-import"),
  title: "Fold thread",
  providerInstanceId: ProviderInstanceId.make("codex"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
  forkedFrom: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
});

interface SeedOptions {
  /** Fork databases from before fork migration 065 lack upstream 050-054. */
  readonly ledgerThrough: 64 | 69;
}

/**
 * Builds a database shaped like a fork install: upstream's V2 tables recorded under the fork's
 * ledger, pitboss tables, real V2 events and projections, and in-flight work.
 */
const seedForkDatabase = (databasePath: string, { ledgerThrough }: SeedOptions) => {
  const sqlite = NodeSqliteClient.layer({ filename: databasePath });
  const schema = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA journal_mode = WAL`;
    if (ledgerThrough === 69) {
      yield* runMigrations({ toMigrationInclusive: 54 });
    } else {
      yield* runMigrations({ toMigrationInclusive: 49 });
    }
    yield* OrchestrationV2Migration;
    yield* PitbossMigration;
    yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id > 49`;
    for (const row of FORK_LEDGER.filter((entry) => entry.migration_id <= ledgerThrough)) {
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${row.migration_id}, ${row.name})`;
    }
  }).pipe(Effect.provide(sqlite));

  const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
    Layer.provideMerge(sqlite),
  );
  const events = Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const thread = makeThread(now);
    yield* sink.write({
      events: [
        {
          id: EventId.make("event:fold-import:created"),
          type: "thread.created",
          threadId,
          occurredAt: now,
          payload: thread,
        },
        {
          id: EventId.make("event:fold-import:auto-settle"),
          type: "thread.auto-settle-set",
          threadId,
          occurredAt: now,
          payload: thread,
        },
      ],
    });
  }).pipe(Effect.provide(EventSink.layer.pipe(Layer.provideMerge(stores))));

  const rows = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const at = "2026-09-01T00:00:00.000Z";
    // The fork's name for thread.auto-settle-set.
    yield* sql`UPDATE orchestration_events SET event_type = 'thread.auto-settle-updated' WHERE event_id = 'event:fold-import:auto-settle'`;
    // Compaction leaves the AUTOINCREMENT high-water mark above MAX(sequence).
    yield* sql`UPDATE sqlite_sequence SET seq = 5000 WHERE name = 'orchestration_events'`;
    yield* sql`INSERT INTO orchestration_v2_effect_outbox (effect_id, command_id, thread_id, effect_type, payload_json, status, attempt_count, available_at, created_at, updated_at)
      VALUES ('effect:done', 'command:a', ${threadId}, 'provider.turn.start', '{}', 'succeeded', 1, ${at}, ${at}, ${at}),
             ('effect:pending', 'command:b', ${threadId}, 'provider.turn.start', '{}', 'pending', 0, ${at}, ${at}, ${at}),
             ('effect:running', 'command:c', ${threadId}, 'provider.turn.start', '{}', 'running', 1, ${at}, ${at}, ${at})`;
    yield* sql`INSERT INTO pitboss_state (id, payload_json) VALUES (1, '{"elected":null}')`;
    yield* sql`INSERT INTO pitboss_events (sequence, operation_id, request_json, payload_json, created_at)
      VALUES (7, 'op:1', '{}', '{}', ${at})`;
    yield* sql`UPDATE sqlite_sequence SET seq = 900 WHERE name = 'pitboss_events'`;
    yield* sql`INSERT INTO pitboss_effects (operation_id, kind, payload_json, state, attempts)
      VALUES ('op:done', 'assign', '{}', 'done', 1), ('op:pending', 'assign', '{}', 'pending', 0)`;
    yield* sql`INSERT INTO pitboss_context_packets (packet_id, thread_id, revision, content, created_at)
      VALUES ('packet:1', ${threadId}, 1, 'packet', ${at})`;
    yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
      VALUES ('project:fold-import', 'Project', '/tmp/project', '[]', ${at}, ${at})`;
    yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, linked_pull_request_json, created_at, updated_at)
      VALUES ('legacy-thread', 'project:fold-import', 'V1 thread', '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', 'default',
        '{"repository":"acme/repo","number":7,"url":"https://github.com/acme/repo/pull/7"}', ${at}, ${at})`;
  }).pipe(Effect.provide(sqlite));

  return Effect.gen(function* () {
    yield* schema;
    yield* events;
    yield* rows;
  });
};

const readLedger = (database: NodeSqlite.DatabaseSync, table = "effect_sql_migrations") =>
  database
    .prepare(`SELECT migration_id, name FROM ${table} ORDER BY migration_id`)
    .all()
    .map((row) => ({ migration_id: Number(row.migration_id), name: String(row.name) }));

const tableCounts = (database: NodeSqlite.DatabaseSync) =>
  Object.fromEntries(
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('effect_sql_migrations', 'fold_sql_migrations') ORDER BY name",
      )
      .all()
      .map((row) => {
        const name = String(row.name);
        return [
          name,
          Number(database.prepare(`SELECT count(*) AS count FROM "${name}"`).get()?.count),
        ];
      }),
  );

const withDirectory = <A, E, R>(
  prefix: string,
  use: (directory: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix))),
    use,
    (directory) => Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
  ).pipe(Effect.provide(NodeServices.layer));

const openReadOnly = <A>(path: string, use: (database: NodeSqlite.DatabaseSync) => A): A => {
  const database = new NodeSqlite.DatabaseSync(path, { readOnly: true });
  try {
    return use(database);
  } finally {
    database.close();
  }
};

/** Spawns a process holding an idle connection, like an old Fold server that is still running. */
const spawnIdleConnection = (databasePath: string) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<NodeChildProcess.ChildProcess>((resolve, reject) => {
          const holder = NodeChildProcess.spawn(
            process.execPath,
            [
              "-e",
              `const { DatabaseSync } = require("node:sqlite");
               const db = new DatabaseSync(process.argv[1]);
               db.prepare("SELECT count(*) FROM effect_sql_migrations").get();
               process.stdout.write("ready\\n");
               process.stdin.on("end", () => db.close());
               process.stdin.resume();`,
              databasePath,
            ],
            { stdio: ["pipe", "pipe", "ignore"] },
          );
          holder.stdout.once("data", () => resolve(holder));
          holder.on("error", reject);
        }),
    ),
    (holder) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            holder.once("exit", () => resolve());
            holder.stdin?.end();
          }),
      ),
  );

describe("classifyLedger", () => {
  it("leaves upstream, preview and pre-V2 ledgers to the upstream migrator", () => {
    assert.deepEqual(classifyLedger([]), { _tag: "upstream" });
    assert.deepEqual(classifyLedger(upstreamLedger), { _tag: "upstream" });
    assert.deepEqual(
      classifyLedger([
        ...upstreamLedger.filter((row) => row.migration_id <= 52),
        { migration_id: 53, name: "OrchestrationV2" },
      ]),
      { _tag: "upstream" },
    );
  });

  it("recognises fork ledgers, including ones from before the pitboss migrations", () => {
    const shared = upstreamLedger.filter((row) => row.migration_id <= 49);
    assert.deepEqual(classifyLedger([...shared, ...FORK_LEDGER]), { _tag: "fork" });
    assert.deepEqual(
      classifyLedger([...shared, ...FORK_LEDGER.filter((row) => row.migration_id <= 61)]),
      { _tag: "fork" },
    );
  });

  it("refuses fork ledgers with rows it cannot map", () => {
    const shared = upstreamLedger.filter((row) => row.migration_id <= 49);
    assert.deepEqual(
      classifyLedger([...shared, ...FORK_LEDGER, { migration_id: 70, name: "FutureFork" }]),
      { _tag: "unrecognized", rows: ["70:FutureFork"] },
    );
    assert.deepEqual(
      classifyLedger([
        ...shared.filter((row) => row.migration_id !== 41),
        { migration_id: 41, name: "OrchestrationV2Projections" },
        ...FORK_LEDGER,
      ]),
      { _tag: "unrecognized", rows: ["41:OrchestrationV2Projections"] },
    );
  });
});

describe("importFoldDatabase", () => {
  it.effect("replaces a fork database with an upstream-ledgered copy of its rows", () =>
    withDirectory("t3-fold-import-", (directory) =>
      Effect.gen(function* () {
        const databasePath = NodePath.join(directory, "statev2.sqlite");
        yield* seedForkDatabase(databasePath, { ledgerThrough: 69 });
        NodeFS.chmodSync(databasePath, 0o600);

        const result = yield* importFoldDatabase(databasePath);
        assert.isTrue(result.imported);
        const backupPath = result.imported ? result.backupPath : undefined;
        assert.isDefined(backupPath);
        assert.match(NodePath.basename(backupPath!), /^statev2\.fold-backup-.+\.sqlite$/);
        assert.deepEqual(NodeFS.readdirSync(directory).sort(), [
          NodePath.basename(backupPath!),
          "statev2.sqlite",
        ]);
        assert.equal(NodeFS.statSync(databasePath).mode & 0o777, 0o600);
        assert.equal(NodeFS.statSync(backupPath!).mode & 0o777, 0o600);

        const backup = openReadOnly(backupPath!, (database) => ({
          ledger: readLedger(database),
          counts: tableCounts(database),
        }));
        assert.equal(backup.ledger.at(-1)?.name, "ProjectionThreadsAutoSettleDisabledAt");

        openReadOnly(databasePath, (database) => {
          assert.deepEqual(readLedger(database), upstreamLedger);
          assert.deepEqual(
            readLedger(database, "fold_sql_migrations"),
            foldMigrationEntries.map(([migration_id, name]) => ({ migration_id, name })),
          );
          const counts = tableCounts(database);
          const retiredV1Tables = new Set([
            "projection_thread_activities",
            "projection_turns",
            "projection_thread_proposed_plans",
            "projection_pending_approvals",
            "projection_state",
            "checkpoint_diff_blobs",
          ]);
          for (const [table, count] of Object.entries(backup.counts)) {
            if (retiredV1Tables.has(table)) {
              assert.isUndefined(counts[table], table);
            } else {
              assert.equal(counts[table], count, table);
            }
          }
          const sequences = Object.fromEntries(
            database
              .prepare("SELECT name, seq FROM sqlite_sequence")
              .all()
              .map((row) => [String(row.name), Number(row.seq)]),
          );
          assert.equal(sequences.orchestration_events, 5000);
          assert.equal(sequences.pitboss_events, 900);
          assert.deepEqual(
            database
              .prepare(
                "SELECT effect_id, status, last_error FROM orchestration_v2_effect_outbox ORDER BY effect_id",
              )
              .all()
              .map((row) => ({ ...row })),
            [
              { effect_id: "effect:done", status: "succeeded", last_error: null },
              { effect_id: "effect:pending", status: "cancelled", last_error: "fork import" },
              { effect_id: "effect:running", status: "cancelled", last_error: "fork import" },
            ],
          );
          assert.deepEqual(
            database
              .prepare(
                "SELECT operation_id, state, error FROM pitboss_effects ORDER BY operation_id",
              )
              .all()
              .map((row) => ({ ...row })),
            [
              { operation_id: "op:done", state: "done", error: null },
              { operation_id: "op:pending", state: "failed", error: "imported" },
            ],
          );
          assert.deepEqual(
            database
              .prepare(
                "SELECT event_type FROM orchestration_events WHERE event_id = 'event:fold-import:auto-settle'",
              )
              .get()?.event_type,
            "thread.auto-settle-set",
          );
        });

        assert.deepEqual(yield* importFoldDatabase(databasePath), { imported: false });

        // The persistence layer opens the result without migrating, and its projections verify.
        const verification = yield* Effect.gen(function* () {
          const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
          return yield* maintenance.verify;
        }).pipe(
          Effect.provide(
            ProjectionMaintenance.layer.pipe(
              Layer.provide(Layer.mergeAll(EventStore.layer, ProjectionStore.layer)),
              Layer.provideMerge(SqlitePersistence.layerFromPath(databasePath)),
            ),
          ),
        );
        assert.isTrue(verification.valid);
        assert.equal(verification.expectedSequence, 2);
      }),
    ),
  );

  it.effect("imports an older fork database that lacks upstream 050-054 columns", () =>
    withDirectory("t3-fold-import-old-", (directory) =>
      Effect.gen(function* () {
        const databasePath = NodePath.join(directory, "statev2.sqlite");
        yield* seedForkDatabase(databasePath, { ledgerThrough: 64 });

        const result = yield* importFoldDatabase(databasePath, { keepBackup: false });
        assert.deepEqual(result, { imported: true, backupPath: undefined });
        assert.deepEqual(NodeFS.readdirSync(directory), ["statev2.sqlite"]);

        openReadOnly(databasePath, (database) => {
          assert.deepEqual(readLedger(database), upstreamLedger);
          assert.deepEqual(
            {
              ...database
                .prepare(
                  "SELECT title, title_state_json, auto_settle_disabled_at FROM projection_threads",
                )
                .get(),
            },
            { title: "V1 thread", title_state_json: null, auto_settle_disabled_at: null },
          );
          // Upstream 050's backfill runs against the copied legacy rows.
          assert.deepEqual(
            {
              ...database
                .prepare(
                  "SELECT thread_id, repository, number FROM projection_thread_pull_requests",
                )
                .get(),
            },
            { thread_id: "legacy-thread", repository: "acme/repo", number: 7 },
          );
          assert.equal(
            Number(database.prepare("SELECT count(*) AS count FROM pitboss_events").get()?.count),
            1,
          );
        });
      }),
    ),
  );

  it.effect("refuses to replace a database another process has open", () =>
    withDirectory("t3-fold-import-busy-", (directory) =>
      Effect.gen(function* () {
        const databasePath = NodePath.join(directory, "statev2.sqlite");
        yield* seedForkDatabase(databasePath, { ledgerThrough: 69 });
        const before = NodeFS.readdirSync(directory).sort();

        const failure = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* spawnIdleConnection(databasePath);
            return yield* Effect.flip(importFoldDatabase(databasePath));
          }),
        );
        assert.equal(failure.reason, "in-use");
        assert.include(failure.message, "Stop other T3 Code / Fold servers");
        assert.deepEqual(NodeFS.readdirSync(directory).sort(), before);
        openReadOnly(databasePath, (database) => {
          assert.equal(readLedger(database).at(-1)?.migration_id, 69);
        });

        // Once the other server stops, the next start imports.
        assert.isTrue((yield* importFoldDatabase(databasePath)).imported);
      }),
    ),
  );

  it.effect("waits for a live import lock and replaces a stale one", () =>
    withDirectory("t3-fold-import-lock-", (directory) =>
      Effect.gen(function* () {
        const databasePath = NodePath.join(directory, "statev2.sqlite");
        const lockPath = NodePath.join(directory, ".fold-import.lock");
        yield* seedForkDatabase(databasePath, { ledgerThrough: 69 });

        NodeFS.writeFileSync(lockPath, `${process.pid}\n`);
        const failure = yield* Effect.flip(importFoldDatabase(databasePath));
        assert.equal(failure.reason, "import-running");
        assert.isTrue(NodeFS.existsSync(lockPath));

        const exited = NodeChildProcess.spawnSync(process.execPath, ["-e", "process.exit(0)"]);
        NodeFS.writeFileSync(lockPath, `${exited.pid}\n`);
        assert.isTrue((yield* importFoldDatabase(databasePath)).imported);
        assert.isFalse(NodeFS.existsSync(lockPath));
      }),
    ),
  );

  it.effect("removes the build directory a killed import left behind", () =>
    withDirectory("t3-fold-import-abandoned-", (directory) =>
      Effect.gen(function* () {
        const databasePath = NodePath.join(directory, "statev2.sqlite");
        yield* seedForkDatabase(databasePath, { ledgerThrough: 69 });
        // What a SIGKILL mid-build leaves: a stale lock and a half-written build directory.
        const exited = NodeChildProcess.spawnSync(process.execPath, ["-e", "process.exit(0)"]);
        NodeFS.writeFileSync(NodePath.join(directory, ".fold-import.lock"), `${exited.pid}\n`);
        const abandoned = NodePath.join(directory, ".fold-import-killed");
        NodeFS.mkdirSync(abandoned);
        NodeFS.writeFileSync(NodePath.join(abandoned, "source.sqlite"), "partial");

        const result = yield* importFoldDatabase(databasePath);
        assert.isTrue(result.imported);
        assert.deepEqual(
          NodeFS.readdirSync(directory)
            .filter((name) => name.startsWith(".fold-import"))
            .sort(),
          [],
        );
      }),
    ),
  );

  it.effect("leaves an unrecognised fork ledger untouched", () =>
    withDirectory("t3-fold-import-unknown-", (directory) =>
      Effect.gen(function* () {
        const databasePath = NodePath.join(directory, "statev2.sqlite");
        yield* seedForkDatabase(databasePath, { ledgerThrough: 69 });
        const database = new NodeSqlite.DatabaseSync(databasePath);
        database.exec(
          "INSERT INTO effect_sql_migrations (migration_id, name) VALUES (70, 'FutureFork')",
        );
        database.close();

        const failure = yield* Effect.flip(importFoldDatabase(databasePath));
        assert.equal(failure.reason, "unrecognized-ledger");
        assert.include(failure.message, "70:FutureFork");
        assert.deepEqual(
          NodeFS.readdirSync(directory).filter((name) => !/-(wal|shm)$/.test(name)),
          ["statev2.sqlite"],
        );
        openReadOnly(databasePath, (database) => {
          assert.equal(readLedger(database).at(-1)?.migration_id, 70);
        });
      }),
    ),
  );

  it.effect("skips missing and upstream databases", () =>
    withDirectory("t3-fold-import-up-", (directory) =>
      Effect.gen(function* () {
        const databasePath = NodePath.join(directory, "statev2.sqlite");
        assert.deepEqual(yield* importFoldDatabase(databasePath), { imported: false });
        yield* runMigrations().pipe(
          Effect.provide(NodeSqliteClient.layer({ filename: databasePath })),
        );
        const before = NodeFS.readFileSync(databasePath);
        assert.deepEqual(yield* importFoldDatabase(databasePath), { imported: false });
        assert.deepEqual(NodeFS.readFileSync(databasePath), before);
      }),
    ),
  );
});
