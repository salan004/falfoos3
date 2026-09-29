import { Router, type Request, type Response } from 'express';
import { requireSuperAdmin } from '../middleware/authorize';
import { resolveSession } from '../auth/session';
import {
  demoteModerator,
  listModerators,
  promoteToLimitedAdmin,
  searchPromotableUsers,
  setCanCreateTournaments,
} from '../auth/adminPermissions';

/**
 * Admin Control & Permissions — moderator management.
 *
 * SUPER_ADMIN-only. Moderators are EXISTING users promoted in place: promotion
 * never creates a user, guest, player or Google identity, and demotion returns
 * the account to a plain user without touching any player data.
 */
export const adminPermissionsRoutes = Router();

adminPermissionsRoutes.use(requireSuperAdmin);

/** List every LIMITED_ADMIN with their current permissions. */
adminPermissionsRoutes.get('/moderators', (_req: Request, res: Response) => {
  try {
    res.json({ moderators: listModerators() });
  } catch (err) {
    console.error('[AdminPermissions] List moderators error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Search EXISTING users eligible for promotion. Only id / display name /
 * avatar are returned — no emails or player identities.
 */
adminPermissionsRoutes.get('/users', (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    res.json({ users: searchPromotableUsers(query) });
  } catch (err) {
    console.error('[AdminPermissions] Search users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Promote an existing user to LIMITED_ADMIN (can_create_tournaments = false). */
adminPermissionsRoutes.post('/moderators', (req: Request, res: Response) => {
  try {
    const userId = (req.body as { userId?: unknown } | undefined)?.userId;
    if (typeof userId !== 'string' || userId.trim().length === 0) {
      res.status(400).json({ error: 'invalid_user_id' });
      return;
    }
    const actor = resolveSession(req);
    const result = promoteToLimitedAdmin(userId.trim(), actor?.id ?? null);
    if (!result.ok) {
      const status = result.error === 'user_not_found' ? 404 : 409;
      res.status(status).json({ error: result.error });
      return;
    }
    res.status(201).json({ moderator: result.moderator });
  } catch (err) {
    console.error('[AdminPermissions] Promote moderator error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Toggle a moderator's `can_create_tournaments` permission. */
adminPermissionsRoutes.patch('/moderators/:userId', (req: Request, res: Response) => {
  try {
    const canCreate = (req.body as { canCreateTournaments?: unknown } | undefined)
      ?.canCreateTournaments;
    if (typeof canCreate !== 'boolean') {
      res.status(400).json({ error: 'invalid_can_create_tournaments' });
      return;
    }
    const actor = resolveSession(req);
    const moderator = setCanCreateTournaments(req.params.userId, canCreate, actor?.id ?? null);
    if (!moderator) {
      res.status(404).json({ error: 'moderator_not_found' });
      return;
    }
    res.json({ moderator });
  } catch (err) {
    console.error('[AdminPermissions] Update permission error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Remove moderator access; the existing account returns to a plain user. */
adminPermissionsRoutes.delete('/moderators/:userId', (req: Request, res: Response) => {
  try {
    const result = demoteModerator(req.params.userId);
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[AdminPermissions] Demote moderator error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
