import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Bootstrap for the Phase 7 website integration test.
 *
 * MUST be the FIRST import in the test file: it sets DB_PATH plus the
 * website-integration env vars BEFORE any module that reads `config/env.ts` is
 * loaded (env.ts snapshots process.env at import time).
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falfoos-integration-test-'));

process.env.DB_PATH = path.join(dir, 'falfoos-test.db');
process.env.WEBSITE_INTEGRATION_SECRET = 'test-website-integration-secret';
process.env.FALFOOS_BOT_URL = 'http://127.0.0.1:9';

export const TEST_DIR = dir;
export const TEST_SECRET = 'test-website-integration-secret';

export function cleanupTestDb(): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
