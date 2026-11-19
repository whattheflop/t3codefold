/**
 * Fold-only schema, recorded in its own `fold_sql_migrations` ledger.
 *
 * Upstream owns every id in `effect_sql_migrations`. A fork migration there collides with the
 * next upstream migration at the same id, and the migrator silently skips one of them. Every
 * fork-only table goes here instead, and `runFoldMigrations` runs right after `runMigrations`.
 */

import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";

import Migration0001 from "./FoldMigrations/001_Pitboss.ts";
import Migration0003 from "./FoldMigrations/003_Factory.ts";
import Migration0004 from "./FoldMigrations/004_FactoryControl.ts";

export const FOLD_MIGRATIONS_TABLE = "fold_sql_migrations";

export const foldMigrationEntries = [
  [1, "Pitboss", Migration0001],
  [3, "Factory", Migration0003],
  [4, "FactoryControl", Migration0004],
  // Factory-only databases may already have applied upstream migration 2, which dropped these tables.
  [5, "EnsurePitboss", Migration0001],
] as const;

const loader = Migrator.fromRecord(
  Object.fromEntries(
    foldMigrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration]),
  ),
);

const run = Migrator.make({});

export const runFoldMigrations = Effect.fn("runFoldMigrations")(function* () {
  const executed = yield* run({ loader, table: FOLD_MIGRATIONS_TABLE });
  if (executed.length > 0) {
    yield* Effect.log("Fold migrations ran successfully").pipe(
      Effect.annotateLogs({ migrations: executed.map(([id, name]) => `${id}_${name}`) }),
    );
  }
  return executed;
});
