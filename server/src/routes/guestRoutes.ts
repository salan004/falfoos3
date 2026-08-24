import { Router } from 'express';
import { ensureGuestIdentity } from '../auth/guest';

/**
 * Phase 11D — guest identity routes. Fully additive: guests stay first-class
 * and nothing existing depends on this router.
 */
export const guestRoutes = Router();

/**
 * Issues (or refreshes) the stable anonymous guest identity cookie and
 * reports the canonical guest player id to the caller.
 */
guestRoutes.get('/identity', (req, res) => {
  const playerId = ensureGuestIdentity(req, res);
  res.json({ playerId });
});
