/**
 * Phase 4B — isolated test database bootstrap.
 *
 * This module MUST be the first import in every competitive DB test so that
 * `process.env.DB_PATH` is set before `../db/db` (and therefore `config/env`)
 * is evaluated. The shared SQLite singleton is then pointed at a throwaway
 * temp file and the full migration chain runs there — never against a real DB.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falfoos-p4b-'));
export const testDbPath = path.join(dir, 'competitive-test.db');

process.env.DB_PATH = testDbPath;

function removeTempFiles(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(testDbPath + suffix, { force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
}

/**
 * Closes the SQLite connection and deletes the temp database + directory.
 * Call at the end of each DB suite (before `summarize`) so Windows file locks
 * are released before the process exits.
 */
export function cleanupTestDb(): void {
  try {
    // Lazily required so this module never imports db.ts at load time, which
    // would defeat the DB_PATH assignment above.
    const { getDb } = require('../db/db') as typeof import('../db/db');
    getDb().close();
  } catch {
    /* connection may already be closed */
  }
  removeTempFiles();
}

process.on('exit', removeTempFiles);
