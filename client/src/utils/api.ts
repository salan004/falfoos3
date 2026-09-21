const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) {
    return `${API_BASE_URL}/${path}`;
  }
  return `${API_BASE_URL}${path}`;
}

export function apiFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
  });
}

/**
 * Phase F1 — resolve an image reference for use in an <img src>.
 *
 * Uploaded images are stored as backend-relative paths (`/api/uploads/...`).
 * In production the frontend and API are separate origins, so those paths must
 * be resolved against the configured API base via `apiUrl()`. Everything else
 * is returned untouched:
 *
 *   /api/uploads/games/x.webp  → <API base>/api/uploads/games/x.webp
 *   /assets/images/x.png       → unchanged (frontend origin)
 *   https://example.com/x.webp → unchanged (absolute)
 *   blob:http://...            → unchanged (local preview)
 *   data:...                   → unchanged
 *   '' / null / undefined      → '' (existing fallback behavior)
 */
export function resolveImageUrl(value: string | null | undefined): string {
  if (!value) return '';
  if (value.startsWith('/api/')) return apiUrl(value);
  return value;
}
