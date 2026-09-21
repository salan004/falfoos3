import { getDb } from '../db/db';
import crypto from 'crypto';

/**
 * Phase 3 — Games data access.
 */

export interface GameRow {
  id: string;
  slug: string;
  name_ar: string;
  description_ar: string | null;
  image_url: string | null;
  is_active: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface CreateGameInput {
  /**
   * Phase F1 — optional. When omitted the slug is generated from `name_ar`
   * and a uniqueness suffix. Existing callers may still supply an explicit
   * slug for backward compatibility.
   */
  slug?: string;
  name_ar: string;
  description_ar?: string;
  image_url?: string;
  is_active?: number;
  sort_order?: number;
}

export interface UpdateGameInput {
  name_ar?: string;
  description_ar?: string;
  image_url?: string;
  is_active?: number;
  sort_order?: number;
}

function rowToGame(row: any): GameRow {
  return {
    id: row.id,
    slug: row.slug,
    name_ar: row.name_ar,
    description_ar: row.description_ar,
    image_url: row.image_url,
    is_active: row.is_active,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateSlug(slug: string): void {
  if (!slug || !slug.trim()) {
    throw new Error('Game slug is required');
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(slug)) {
    throw new Error('Game slug must contain only lowercase letters, numbers, and underscores, starting with a letter or underscore');
  }
}

function validateNameAr(nameAr: string): void {
  if (!nameAr || !nameAr.trim()) {
    throw new Error('Arabic name is required');
  }
  if (nameAr.length > 100) {
    throw new Error('Arabic name must be 100 characters or less');
  }
}

/**
 * Phase F1 — derive an ASCII slug base from a game name. Arabic names yield an
 * empty base, so callers fall back to the generic `game` base and rely on the
 * uniqueness loop below. The result always satisfies `validateSlug`.
 */
function slugifyGameName(nameAr: string): string {
  const base = nameAr
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return base.length > 0 ? base : 'game';
}

/** Appends a numeric suffix until the slug is unique across `games`. */
function generateUniqueSlug(base: string): string {
  const db = getDb();
  let candidate = base;
  let suffix = 1;
  while (db.prepare('SELECT id FROM games WHERE slug = ?').get(candidate)) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
  return candidate;
}

export function getAllGames(): GameRow[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM games ORDER BY sort_order ASC, name_ar ASC').all();
  return rows.map(rowToGame);
}

export function getActiveGames(): GameRow[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM games WHERE is_active = 1 ORDER BY sort_order ASC, name_ar ASC').all();
  return rows.map(rowToGame);
}

export function getGameById(id: string): GameRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  return row ? rowToGame(row) : null;
}

export function getGameBySlug(slug: string): GameRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM games WHERE slug = ?').get(slug);
  return row ? rowToGame(row) : null;
}

export function createGame(input: CreateGameInput): GameRow {
  const db = getDb();
  validateNameAr(input.name_ar);

  const providedSlug = input.slug?.trim();
  let slug: string;
  if (providedSlug) {
    validateSlug(providedSlug);
    if (db.prepare('SELECT id FROM games WHERE slug = ?').get(providedSlug)) {
      throw new Error(`Game slug '${providedSlug}' already exists`);
    }
    slug = providedSlug;
  } else {
    slug = generateUniqueSlug(slugifyGameName(input.name_ar));
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const isActive = input.is_active ?? 1;
  const sortOrder = input.sort_order ?? 0;

  db.prepare(`
    INSERT INTO games (id, slug, name_ar, description_ar, image_url, is_active, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, slug, input.name_ar, input.description_ar ?? null, input.image_url ?? null, isActive, sortOrder, now, now);

  const game = getGameById(id);
  if (!game) {
    throw new Error('Failed to retrieve created game');
  }
  return game;
}

export function updateGame(id: string, input: UpdateGameInput): GameRow {
  const db = getDb();

  const existing = getGameById(id);
  if (!existing) {
    throw new Error('Game not found');
  }

  if (input.name_ar !== undefined) {
    validateNameAr(input.name_ar);
    const dup = db.prepare('SELECT id FROM games WHERE name_ar = ? AND id != ?').get(input.name_ar, id);
    if (dup) {
      throw new Error(`Game Arabic name '${input.name_ar}' already exists`);
    }
  }

  const updates: string[] = [];
  const params: any[] = [];

  if (input.name_ar !== undefined) {
    updates.push('name_ar = ?');
    params.push(input.name_ar);
  }
  if (input.description_ar !== undefined) {
    updates.push('description_ar = ?');
    params.push(input.description_ar);
  }
  if (input.image_url !== undefined) {
    updates.push('image_url = ?');
    params.push(input.image_url);
  }
  if (input.is_active !== undefined) {
    updates.push('is_active = ?');
    params.push(input.is_active ? 1 : 0);
  }
  if (input.sort_order !== undefined) {
    updates.push('sort_order = ?');
    params.push(input.sort_order);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = ?');
  params.push(Date.now());
  params.push(id);

  db.prepare(`UPDATE games SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const game = getGameById(id);
  if (!game) {
    throw new Error('Failed to retrieve updated game');
  }
  return game;
}

export function deactivateGame(id: string): GameRow {
  return updateGame(id, { is_active: 0 });
}