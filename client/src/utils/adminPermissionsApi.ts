import { apiFetch } from './api';

/**
 * Admin Control & Permissions — moderator management API (SUPER_ADMIN only).
 * Thin transport over the existing `/api/admin/permissions` endpoints.
 */

export interface Moderator {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  canCreateTournaments: boolean;
}

export interface PromotableUser {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface AdminApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<AdminApiResult<T>> {
  try {
    const res = await apiFetch(path, init);
    const text = await res.text();
    let data: T | null = null;
    let error: string | null = null;
    if (text.length > 0) {
      try {
        const parsed = JSON.parse(text) as T & { error?: string };
        data = parsed;
        if (!res.ok) error = parsed.error ?? 'request_failed';
      } catch {
        if (!res.ok) error = 'request_failed';
      }
    } else if (!res.ok) {
      error = 'request_failed';
    }
    return { ok: res.ok, status: res.status, data, error };
  } catch {
    return { ok: false, status: 0, data: null, error: 'network_error' };
  }
}

export function listModerators(): Promise<AdminApiResult<{ moderators: Moderator[] }>> {
  return jsonRequest('/api/admin/permissions/moderators');
}

export function searchPromotableUsers(q: string): Promise<AdminApiResult<{ users: PromotableUser[] }>> {
  const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return jsonRequest(`/api/admin/permissions/users${query}`);
}

export function promoteModerator(userId: string): Promise<AdminApiResult<{ moderator: Moderator }>> {
  return jsonRequest('/api/admin/permissions/moderators', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
}

export function setModeratorCanCreateTournaments(
  userId: string,
  canCreateTournaments: boolean
): Promise<AdminApiResult<{ moderator: Moderator }>> {
  return jsonRequest(`/api/admin/permissions/moderators/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canCreateTournaments }),
  });
}

export function demoteModerator(userId: string): Promise<AdminApiResult<{ ok: true }>> {
  return jsonRequest(`/api/admin/permissions/moderators/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}
