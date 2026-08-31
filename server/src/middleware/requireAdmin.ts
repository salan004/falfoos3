import type { Request, Response, NextFunction } from 'express';
import { resolveSession } from '../auth/session';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = resolveSession(req);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}