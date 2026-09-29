/**
 * Backward-compatible re-export. The authorization abstraction now lives in
 * `./authorize` (requireAdmin / requireSuperAdmin / requirePermission).
 */
export { requireAdmin } from './authorize';
