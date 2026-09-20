/**
 * Phase 8 — link intent operation discriminator (additive).
 *
 * An account-linking attempt is now one of two explicit operations:
 * - LINK_EXISTING_PLAYER — claim a Player already created by the tournament/bot
 * - REGISTER_NEW_PLAYER — create (only when the verified channel has none) and claim
 *
 * Additive column with a safe default, so pre-existing intents (and any caller
 * that omits the operation) remain valid as LINK_EXISTING_PLAYER. The terminal
 * `status` CHECK is intentionally untouched; both operations complete as CLAIMED.
 */
export const migration0026LinkIntentsOperation = {
  id: '0026_link_intents_operation',
  sql: `
ALTER TABLE link_intents
ADD COLUMN operation TEXT NOT NULL DEFAULT 'LINK_EXISTING_PLAYER'
CHECK (operation IN ('LINK_EXISTING_PLAYER','REGISTER_NEW_PLAYER'));
`,
};
