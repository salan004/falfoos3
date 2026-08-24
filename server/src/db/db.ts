import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate';
import { migrations } from './migrations';

/**
 * Phase 11B — SQLite foundation (better-sqlite3).
 * Single embedded database file, WAL mode, FK enforcement ON.
 *
 * Default location: <server>/data/falfoos.db (gitignored), overridable via
 * the DB_PATH environment variable. The database is opened and migrated once
 * per process; every caller afterwards receives the same instance.
 */

export interface DbInitResult {
  dbPath: string;
  appliedNow: number;
  totalMigrations: number;
}

let instance: Database.Database | null = null;
let initResult: DbInitResult | null = null;

function resolveDbPath(): string {
  const fromEnv = process.env.DB_PATH?.trim();
  if (fromEnv) return fromEnv;
  // __dirname is <server>/dist/db (built) or <server>/src/db (ts-node-dev);
  // resolving two levels up lands on the server root in both cases.
  return path.resolve(__dirname, '..', '..', 'data', 'falfoos.db');
}

export function initDatabase(): DbInitResult {
  if (initResult) return initResult;

  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const appliedNow = runMigrations(db);

  instance = db;
  initResult = { dbPath, appliedNow, totalMigrations: migrations.length };
  return initResult;
}

/** Shared connection accessor for later phases (auth, persistence hooks). */
export function getDb(): Database.Database {
  if (!instance) initDatabase();
  return instance!;
}
