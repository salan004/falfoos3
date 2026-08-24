import { migrations } from './migrations';

export interface AppliedMigration {
  id: string;
}

/**
 * Idempotent migration runner: applies pending migrations in order, each one
 * inside a transaction that also records it into the `_migrations` ledger.
 * Returns how many migrations were newly applied.
 */
export function runMigrations(db: import('better-sqlite3').Database): number {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name       TEXT PRIMARY KEY NOT NULL,
       applied_at INTEGER NOT NULL
     )`
  );

  const appliedRows = db.prepare('SELECT name FROM _migrations').all() as { name: string }[];
  const applied = new Set(appliedRows.map((r) => r.name));

  let appliedNow = 0;
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(
        migration.id,
        Date.now()
      );
    });
    apply();
    appliedNow++;
  }

  return appliedNow;
}
