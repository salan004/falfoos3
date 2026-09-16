/**
 * Bot webhook test bootstrap.
 *
 * MUST be the FIRST import in the bot webhook test file. It sets DB_PATH (via
 * the shared competitive test bootstrap) and BOT_WEBHOOK_SECRET BEFORE the
 * config/env and db singletons are evaluated, so the route/middleware under
 * test see an isolated database and a known HMAC secret.
 */
import '../competitive/testDb';

export const TEST_BOT_WEBHOOK_SECRET = 'test-bot-webhook-secret';
process.env.BOT_WEBHOOK_SECRET = TEST_BOT_WEBHOOK_SECRET;
