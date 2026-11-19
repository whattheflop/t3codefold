import * as NodeSqlite from "node:sqlite";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as EventStore from "../orchestration-v2/EventStore.ts";
// A legacy Fold database keeps its full event log, so a one-time replay is valid here.
import * as ProjectionReplay from "../orchestration-v2/testkit/ProjectionReplay.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { FOLD_MIGRATIONS_TABLE, runFoldMigrations } from "./FoldMigrations.ts";
import { migrationManifest, runMigrations } from "./Migrations.ts";
import BackfillProjectionThreadPullRequests from "./Migrations/050_ProjectionThreadPullRequests.ts";

/**
 * The fork recorded upstream's V2 schema under its own migration ids (50-61, then pitboss at
 * 62-64 and upstream's 050-054 again at 65-69). Upstream never records these names at these
 * ids, so any one of them identifies a fork database.
 */
const FORK_SIGNATURE: ReadonlyMap<number, string> = new Map([
  [50, "OrchestrationV2"],
  [51, "OrchestrationV2Subagents"],
  [52, "OrchestrationV2Foundation"],
  [53, "OrchestrationV2ProviderSessionBindings"],
  [54, "OrchestrationV2ThreadLaunchWorkflows"],
  [55, "ApplicationEventSource"],
  [56, "OrchestrationV2EffectCancellation"],
  [57, "ScheduledTasks"],
  [58, "LegacyV1ImportState"],
  [59, "ApplicationEventSequenceIndexes"],
  [60, "OrchestrationV2RecoveryIndexes"],
  [61, "OrchestrationV2ShellIndexes"],
  [62, "Pitboss"],
  [63, "PitbossPeers"],
  [64, "PitbossMail"],
  [65, "ProjectionThreadMessageContext"],
  [66, "ProjectionThreadTitleState"],
  [67, "PullRequestFilesViewed"],
  [68, "ProjectionThreadPullRequests"],
  [69, "ProjectionThreadsAutoSettleDisabledAt"],
]);

// The fork and upstream share migrations 1-49 by id and name.
const SHARED_MIGRATIONS: ReadonlyMap<number, string> = new Map(
  migrationManifest.filter(([id]) => id <= 49),
);

export interface MigrationLedgerRow {
  readonly migration_id: number;
  readonly name: string;
}

export type FoldLedgerClassification =
  | { readonly _tag: "upstream" }
  | { readonly _tag: "fork" }
  | { readonly _tag: "unrecognized"; readonly rows: ReadonlyArray<string> };

/** Decides whether a migration ledger needs the fork import. */
export const classifyLedger = (
  rows: ReadonlyArray<MigrationLedgerRow>,
): FoldLedgerClassification => {
  const isFork = rows.some((row) => FORK_SIGNATURE.get(Number(row.migration_id)) === row.name);
  if (!isFork) return { _tag: "upstream" };
  const unrecognized = rows.flatMap((row) => {
    const id = Number(row.migration_id);
    const known = SHARED_MIGRATIONS.get(id) ?? FORK_SIGNATURE.get(id);
    return known === row.name ? [] : [`${id}:${row.name}`];
  });
  return unrecognized.length === 0
    ? { _tag: "fork" }
    : { _tag: "unrecognized", rows: unrecognized };
};

export class FoldDatabaseImportError extends Schema.TaggedError<FoldDatabaseImportError>()(
  "FoldDatabaseImportError",
  {
    databasePath: Schema.String,
    reason: Schema.Literals([
      "unrecognized-ledger",
      "in-use",
      "import-running",
      "verification-failed",
      "failed",
    ]),
    detail: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    const unchanged = `The database at ${this.databasePath} has not been changed.`;
    switch (this.reason) {
      case "unrecognized-ledger":
        return `The database at ${this.databasePath} has a Fold migration history this build does not recognise (${this.detail ?? "unknown rows"}). ${unchanged} Start the Fold build that created it, or restore a backup.`;
      case "in-use":
        return `Stop other T3 Code / Fold servers using this data directory, then start again. Another process has ${this.databasePath} open, so it cannot be upgraded. ${unchanged}`;
      case "import-running":
        return `Another process (${this.detail ?? "unknown pid"}) is upgrading ${this.databasePath}. Wait for it to finish, or stop it, then start again.`;
      case "verification-failed":
        return `The upgraded copy of ${this.databasePath} failed verification (${this.detail ?? "unknown"}). ${unchanged}`;
      case "failed":
        return `Could not upgrade the Fold database at ${this.databasePath}. ${unchanged}`;
    }
  }
}

const isFoldDatabaseImportError = Schema.is(FoldDatabaseImportError);

export interface ImportFoldDatabaseOptions {
  /** Keep the pre-import snapshot as `<name>.fold-backup-<timestamp>.sqlite`. Defaults to true. */
  readonly keepBackup?: boolean | undefined;
}

export type ImportFoldDatabaseResult =
  | { readonly imported: false }
  | { readonly imported: true; readonly backupPath: string | undefined };

const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const isBusyError = (cause: unknown) =>
  typeof cause === "object" &&
  cause !== null &&
  "errcode" in cause &&
  // SQLITE_BUSY, SQLITE_LOCKED
  (cause.errcode === 5 || cause.errcode === 6);

const readLedger = (databasePath: string) =>
  Effect.try({
    try: () => {
      const database = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
      try {
        const table = database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'",
          )
          .get();
        if (table === undefined) return [];
        return database
          .prepare("SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id")
          .all()
          .map((row) => ({ migration_id: Number(row.migration_id), name: String(row.name) }));
      } finally {
        database.close();
      }
    },
    catch: (cause) =>
      new FoldDatabaseImportError({
        databasePath,
        reason: isBusyError(cause) ? "in-use" : "failed",
        cause,
      }),
  });

const classify = Effect.fn("importFoldDatabase.classify")(function* (databasePath: string) {
  const classification = classifyLedger(yield* readLedger(databasePath));
  if (classification._tag === "unrecognized") {
    return yield* new FoldDatabaseImportError({
      databasePath,
      reason: "unrecognized-ledger",
      detail: classification.rows.join(", "),
    });
  }
  return classification._tag === "fork";
});

/** An O_EXCL lock file holding the importer's pid. A lock left by a dead process is replaced. */
const acquireImportLock = Effect.fn("importFoldDatabase.acquireImportLock")(function* (
  lockPath: string,
  databasePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const create = fs.writeFileString(lockPath, `${process.pid}\n`, { flag: "wx" });
  const held = (detail: string) =>
    new FoldDatabaseImportError({ databasePath, reason: "import-running", detail });
  yield* Effect.acquireRelease(
    create.pipe(
      Effect.catchIf(
        (error) => !(error.reason._tag !== "AlreadyExists"),
        () =>
          Effect.gen(function* () {
            const holder = Number.parseInt(
              yield* fs.readFileString(lockPath).pipe(Effect.orElseSucceed(() => "")),
              10,
            );
            if (Number.isInteger(holder) && holder > 0 && isProcessAlive(holder)) {
              return yield* held(`pid ${holder}`);
            }
            yield* fs.remove(lockPath, { force: true });
            yield* create.pipe(
              Effect.mapError((retryError) =>
                retryError.reason._tag === "AlreadyExists" ? held(`lock ${lockPath}`) : retryError,
              ),
            );
          }),
      ),
      Effect.mapError((cause) =>
        isFoldDatabaseImportError(cause)
          ? cause
          : new FoldDatabaseImportError({ databasePath, reason: "failed", cause }),
      ),
    ),
    () => fs.remove(lockPath, { force: true }).pipe(Effect.ignore),
  );
});

const BUILD_DIRECTORY_PREFIX = ".fold-import-";

/**
 * A killed import (SIGKILL, power loss) skips its scoped cleanup and leaves a build directory of
 * up to twice the database size. Only the import lock holder may call this, so any build
 * directory left in the state dir belongs to a dead process.
 */
const removeAbandonedBuilds = Effect.fn("importFoldDatabase.removeAbandonedBuilds")(function* (
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const name of yield* fs.readDirectory(directory)) {
    if (!name.startsWith(BUILD_DIRECTORY_PREFIX)) continue;
    yield* Effect.logWarning("Removing an abandoned Fold database upgrade").pipe(
      Effect.annotateLogs({ path: path.join(directory, name) }),
    );
    yield* fs.remove(path.join(directory, name), { recursive: true, force: true });
  }
});

/**
 * Holds the source exclusively until the import publishes. With `locking_mode=EXCLUSIVE` the
 * first write transaction takes a lock that is kept until close, so any other open connection,
 * such as an old Fold server, fails this step with SQLITE_BUSY instead of writing into a file
 * that is about to be replaced.
 */
const lockSource = (databasePath: string) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => {
        const database = new NodeSqlite.DatabaseSync(databasePath);
        try {
          database.exec("PRAGMA busy_timeout = 0");
          database.exec("PRAGMA locking_mode = EXCLUSIVE");
          database.exec("BEGIN EXCLUSIVE");
          database.exec("COMMIT");
          const checkpoint = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
          if (checkpoint !== undefined && Number(checkpoint.busy) !== 0) {
            throw Object.assign(new Error("WAL checkpoint was blocked"), { errcode: 5 });
          }
          return database;
        } catch (error) {
          database.close();
          throw error;
        }
      },
      catch: (cause) =>
        new FoldDatabaseImportError({
          databasePath,
          reason: isBusyError(cause) ? "in-use" : "failed",
          cause,
        }),
    }),
    (database) => Effect.sync(() => database.isOpen && database.close()),
  );

const snapshotSource = (
  source: NodeSqlite.DatabaseSync,
  snapshotPath: string,
  databasePath: string,
) =>
  Effect.tryPromise({
    try: async () => {
      await NodeSqlite.backup(source, snapshotPath);
      // A rollback-journal snapshot is one self-contained file, for ATTACH and as the backup.
      const snapshot = new NodeSqlite.DatabaseSync(snapshotPath);
      try {
        snapshot.exec("PRAGMA journal_mode = DELETE");
      } finally {
        snapshot.close();
      }
    },
    catch: (cause) => new FoldDatabaseImportError({ databasePath, reason: "failed", cause }),
  });

/** Copies the fork snapshot into the current database, which already has the upstream schema. */
const copySnapshot = Effect.fn("importFoldDatabase.copySnapshot")(function* (snapshotPath: string) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ATTACH DATABASE ${snapshotPath} AS fold_source`;
  const sourceTables = new Set(
    (yield* sql<{ readonly name: string }>`
      SELECT name FROM fold_source.sqlite_master WHERE type = 'table'
    `).map((row) => row.name),
  );
  const tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM main.sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT IN ('effect_sql_migrations', ${FOLD_MIGRATIONS_TABLE})
    ORDER BY name
  `;
  const now = DateTime.formatIso(yield* DateTime.now);
  yield* sql.withTransaction(
    Effect.gen(function* () {
      for (const { name } of tables) {
        if (!sourceTables.has(name)) continue;
        // Older fork databases lack later columns; those take the upstream defaults.
        const columns = yield* sql<{ readonly name: string }>`
          SELECT target.name FROM pragma_table_info(${name}, 'main') AS target
          JOIN pragma_table_info(${name}, 'fold_source') AS source ON source.name = target.name
          ORDER BY target.cid
        `;
        if (columns.length === 0) continue;
        const columnList = columns.map((column) => quoteIdentifier(column.name)).join(", ");
        const table = quoteIdentifier(name);
        // OR REPLACE: the fresh schema seeds rows such as the projection metadata cursor.
        yield* sql.unsafe(
          `INSERT OR REPLACE INTO main.${table} (${columnList}) SELECT ${columnList} FROM fold_source.${table}`,
        );
      }

      // Compaction leaves AUTOINCREMENT high-water marks above MAX(rowid); keep them so
      // event sequences and projection cursors never reuse an id.
      if (sourceTables.has("sqlite_sequence")) {
        yield* sql`
          UPDATE main.sqlite_sequence
          SET seq = MAX(seq, (
            SELECT source.seq FROM fold_source.sqlite_sequence AS source
            WHERE source.name = main.sqlite_sequence.name
          ))
          WHERE name IN (SELECT name FROM fold_source.sqlite_sequence)
        `;
        yield* sql`
          INSERT INTO main.sqlite_sequence (name, seq)
          SELECT source.name, source.seq FROM fold_source.sqlite_sequence AS source
          WHERE source.name NOT IN (SELECT name FROM main.sqlite_sequence)
            AND source.name IN (SELECT name FROM main.sqlite_master WHERE type = 'table')
        `;
      }

      // Fork databases from before fork migration 068 have no pull request link table;
      // upstream's 050 backfills it from the legacy thread rows that were just copied.
      if (!sourceTables.has("projection_thread_pull_requests")) {
        yield* BackfillProjectionThreadPullRequests;
      }

      // In-flight work was queued by the fork's code. Never replay it under this build.
      yield* sql`
        UPDATE orchestration_v2_effect_outbox
        SET status = 'cancelled',
            lease_owner = NULL,
            lease_expires_at = NULL,
            completed_at = ${now},
            updated_at = ${now},
            last_error = 'fork import'
        WHERE status IN ('pending', 'running')
      `;

      // Replaying `assign` or `create-lead` would create threads that already exist.
      yield* sql`
        UPDATE pitboss_effects SET state = 'failed', error = 'imported'
        WHERE state NOT IN ('done', 'failed')
      `;

      // The fork's name for upstream's thread.auto-settle-set; the payload is the same thread.
      yield* sql`
        UPDATE orchestration_events SET event_type = 'thread.auto-settle-set'
        WHERE application_event_version = 2
          AND aggregate_kind = 'thread'
          AND event_type = 'thread.auto-settle-updated'
      `;
    }),
  );
  yield* sql`DETACH DATABASE fold_source`;
});

const verifyProjections = Effect.fn("importFoldDatabase.verifyProjections")(function* (
  databasePath: string,
) {
  const maintenance = yield* ProjectionReplay.ProjectionReplay;
  const verified = yield* maintenance.verify;
  const result = verified.valid ? verified : yield* maintenance.rebuild;
  if (!result.valid) {
    return yield* new FoldDatabaseImportError({
      databasePath,
      reason: "verification-failed",
      detail: [
        `schema ${result.schemaVersion}`,
        `sequence ${result.projectionSequence}/${result.expectedSequence}`,
        `${result.missingThreadIds.length} missing`,
        `${result.unexpectedThreadIds.length} unexpected`,
        `${result.unreadableThreadIds.length} unreadable`,
      ].join(", "),
    });
  }
  return { rebuilt: !verified.valid };
});

const buildDatabase = Effect.fn("importFoldDatabase.buildDatabase")(function* (
  databasePath: string,
  buildPath: string,
  snapshotPath: string,
) {
  const sqlite = NodeSqliteClient.layer({ filename: buildPath });
  const maintenance = ProjectionReplay.layer.pipe(
    Layer.provide(Layer.mergeAll(EventStore.layer, ProjectionStore.layer)),
    Layer.provideMerge(sqlite),
  );
  return yield* Effect.gen(function* () {
    yield* runMigrations();
    yield* runFoldMigrations();
    yield* copySnapshot(snapshotPath);
    return yield* verifyProjections(databasePath);
  }).pipe(Effect.provide(maintenance));
});

// Import under an exclusive lock before persistence migrates. Preserve the snapshot beside
// the database; failures before publication leave the original untouched and retry on start.
export const importFoldDatabase = Effect.fn("importFoldDatabase")(function* (
  databasePath: string,
  options: ImportFoldDatabaseOptions = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skipped: ImportFoldDatabaseResult = { imported: false };
  if (!(yield* fs.exists(databasePath))) return skipped;
  if (!(yield* classify(databasePath))) return skipped;

  const directory = path.dirname(databasePath);
  const failed = (cause: unknown) =>
    isFoldDatabaseImportError(cause)
      ? cause
      : new FoldDatabaseImportError({ databasePath, reason: "failed", cause });

  return yield* Effect.gen(function* () {
    yield* acquireImportLock(path.join(directory, ".fold-import.lock"), databasePath);
    yield* removeAbandonedBuilds(directory);
    // Another process may have finished the import while this one waited for the lock.
    if (!(yield* classify(databasePath))) return skipped;

    const source = yield* lockSource(databasePath);
    const { mode } = yield* fs.stat(databasePath);
    const temporaryDirectory = yield* fs.makeTempDirectoryScoped({
      directory,
      prefix: BUILD_DIRECTORY_PREFIX,
    });
    const snapshotPath = path.join(temporaryDirectory, "source.sqlite");
    const buildPath = path.join(temporaryDirectory, path.basename(databasePath));

    yield* Effect.log("Upgrading Fold database to the upstream schema").pipe(
      Effect.annotateLogs({ databasePath }),
    );
    yield* snapshotSource(source, snapshotPath, databasePath);
    const { rebuilt } = yield* buildDatabase(databasePath, buildPath, snapshotPath);

    let backupPath: string | undefined;
    if (options.keepBackup ?? true) {
      const timestamp = DateTime.formatIso(yield* DateTime.now).replaceAll(/[:.]/g, "-");
      backupPath = path.join(
        directory,
        `${path.basename(databasePath, ".sqlite")}.fold-backup-${timestamp}.sqlite`,
      );
      yield* fs.rename(snapshotPath, backupPath);
      yield* fs.chmod(backupPath, mode & 0o777);
    }

    // Never rename over a live WAL database: the exclusive close checkpoints and deletes the WAL.
    yield* Effect.sync(() => source.close());
    const walPath = `${databasePath}-wal`;
    if ((yield* fs.exists(walPath)) && Number((yield* fs.stat(walPath)).size) > 0) {
      return yield* new FoldDatabaseImportError({
        databasePath,
        reason: "in-use",
        detail: `${walPath} is not empty`,
      });
    }
    // Read-only connections leave a -shm the exclusive connection never used; drop it with the
    // database it described.
    yield* fs.remove(walPath, { force: true });
    yield* fs.remove(`${databasePath}-shm`, { force: true });
    yield* fs.chmod(buildPath, mode & 0o777);
    yield* fs.rename(buildPath, databasePath);

    yield* Effect.log("Upgraded Fold database to the upstream schema").pipe(
      Effect.annotateLogs({ databasePath, backupPath, rebuiltProjections: rebuilt }),
    );
    const imported: ImportFoldDatabaseResult = { imported: true, backupPath };
    return imported;
  }).pipe(Effect.scoped, Effect.mapError(failed));
});
