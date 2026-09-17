import { getDb } from '../db/db';
import crypto from 'crypto';

/**
 * Phase 3 — Tournaments data access.
 */

export interface TournamentRow {
  id: string;
  game_id: string;
  name_ar: string;
  description_ar: string | null;
  image_url: string | null;
  status: 'draft' | 'open' | 'active' | 'completed' | 'cancelled';
  max_participants: number | null;
  starts_at: number | null;
  ends_at: number | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface CreateTournamentInput {
  game_id: string;
  name_ar: string;
  description_ar?: string;
  image_url?: string;
  max_participants?: number;
  starts_at?: number;
  ends_at?: number;
  status?: 'draft' | 'open';
}

export interface UpdateTournamentInput {
  name_ar?: string;
  description_ar?: string;
  image_url?: string;
  max_participants?: number | null;
  starts_at?: number | null;
  ends_at?: number | null;
  status?: 'draft' | 'open' | 'active' | 'completed' | 'cancelled';
}

export interface TournamentWithGame extends TournamentRow {
  game_name_ar: string;
  game_slug: string;
  game_image_url: string | null;
  participant_count: number;
}

function rowToTournament(row: any): TournamentRow {
  return {
    id: row.id,
    game_id: row.game_id,
    name_ar: row.name_ar,
    description_ar: row.description_ar,
    image_url: row.image_url,
    status: row.status,
    max_participants: row.max_participants,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateTournamentName(nameAr: string): void {
  if (!nameAr || !nameAr.trim()) {
    throw new Error('Tournament name is required');
  }
  if (nameAr.length > 150) {
    throw new Error('Tournament name must be 150 characters or less');
  }
}

function validateGameExists(gameId: string): void {
  const db = getDb();
  const game = db.prepare('SELECT id FROM games WHERE id = ? AND is_active = 1').get(gameId);
  if (!game) {
    throw new Error('Game not found or inactive');
  }
}

function validateStatusTransition(currentStatus: string, newStatus: string): void {
  const validTransitions: Record<string, string[]> = {
    draft: ['open', 'cancelled'],
    open: ['active', 'cancelled'],
    active: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  };
  if (!validTransitions[currentStatus]?.includes(newStatus)) {
    throw new Error(`Invalid status transition from ${currentStatus} to ${newStatus}`);
  }
}

export function getAllTournaments(): TournamentRow[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM tournaments ORDER BY created_at DESC').all();
  return rows.map(rowToTournament);
}

export function getTournamentsByGame(gameId: string): TournamentRow[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM tournaments WHERE game_id = ? ORDER BY created_at DESC').all(gameId);
  return rows.map(rowToTournament);
}

export function getActiveTournaments(): TournamentRow[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM tournaments WHERE status IN ('open','active') ORDER BY starts_at ASC").all();
  return rows.map(rowToTournament);
}

export function getTournamentsWithGameInfo(): TournamentWithGame[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT t.*, g.name_ar as game_name_ar, g.slug as game_slug, g.image_url as game_image_url,
           (SELECT COUNT(*) FROM tournament_participants
             WHERE tournament_id = t.id AND status IN ('registered','confirmed')) as participant_count
    FROM tournaments t
    JOIN games g ON g.id = t.game_id
    ORDER BY t.created_at DESC
  `).all() as TournamentWithGameRow[];
  return rows.map((row) => ({
    ...rowToTournament(row),
    game_name_ar: row.game_name_ar,
    game_slug: row.game_slug,
    game_image_url: row.game_image_url,
    participant_count: row.participant_count,
  }));
}

export function getTournamentById(id: string): TournamentRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  return row ? rowToTournament(row) : null;
}

interface TournamentWithGameRow extends TournamentRow {
  game_name_ar: string;
  game_slug: string;
  game_image_url: string | null;
  participant_count: number;
}

export function getTournamentWithGameInfo(id: string): TournamentWithGame | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT t.*, g.name_ar as game_name_ar, g.slug as game_slug, g.image_url as game_image_url,
           (SELECT COUNT(*) FROM tournament_participants
             WHERE tournament_id = t.id AND status IN ('registered','confirmed')) as participant_count
    FROM tournaments t
    JOIN games g ON g.id = t.game_id
    WHERE t.id = ?
  `).get(id) as TournamentWithGameRow | undefined;
  return row ? {
    ...rowToTournament(row),
    game_name_ar: row.game_name_ar,
    game_slug: row.game_slug,
    game_image_url: row.game_image_url,
    participant_count: row.participant_count,
  } : null;
}

export function createTournament(input: CreateTournamentInput, createdBy: string): TournamentRow {
  const db = getDb();
  validateTournamentName(input.name_ar);
  validateGameExists(input.game_id);

  const status = input.status ?? 'draft';
  if (status !== 'draft' && status !== 'open') {
    throw new Error('Initial status must be draft or open');
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO tournaments (id, game_id, name_ar, description_ar, image_url, status, max_participants, starts_at, ends_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.game_id,
    input.name_ar,
    input.description_ar ?? null,
    input.image_url ?? null,
    status,
    input.max_participants ?? null,
    input.starts_at ?? null,
    input.ends_at ?? null,
    createdBy,
    now,
    now
  );

  const tournament = getTournamentById(id);
  if (!tournament) {
    throw new Error('Failed to retrieve created tournament');
  }
  return tournament;
}

export function updateTournament(id: string, input: UpdateTournamentInput): TournamentRow {
  const db = getDb();

  const existing = getTournamentById(id);
  if (!existing) {
    throw new Error('Tournament not found');
  }

  if (input.name_ar !== undefined) {
    validateTournamentName(input.name_ar);
    const dup = db.prepare('SELECT id FROM tournaments WHERE name_ar = ? AND id != ?').get(input.name_ar, id);
    if (dup) {
      throw new Error(`Tournament name '${input.name_ar}' already exists`);
    }
  }

  if (input.status !== undefined && input.status !== existing.status) {
    validateStatusTransition(existing.status, input.status);
  }

  if (input.max_participants !== undefined && input.max_participants !== null && input.max_participants < 1) {
    throw new Error('Maximum participants must be at least 1');
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
  if (input.max_participants !== undefined) {
    updates.push('max_participants = ?');
    params.push(input.max_participants);
  }
  if (input.starts_at !== undefined) {
    updates.push('starts_at = ?');
    params.push(input.starts_at);
  }
  if (input.ends_at !== undefined) {
    updates.push('ends_at = ?');
    params.push(input.ends_at);
  }
  if (input.status !== undefined) {
    updates.push('status = ?');
    params.push(input.status);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = ?');
  params.push(Date.now());
  params.push(id);

  db.prepare(`UPDATE tournaments SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const tournament = getTournamentById(id);
  if (!tournament) {
    throw new Error('Failed to retrieve updated tournament');
  }
  return tournament;
}

export function deleteTournament(id: string): boolean {
  const db = getDb();
  const existing = getTournamentById(id);
  if (!existing) {
    throw new Error('Tournament not found');
  }
  // Only allow deletion of draft tournaments
  if (existing.status !== 'draft') {
    throw new Error('Only draft tournaments can be deleted');
  }
  return db.prepare('DELETE FROM tournaments WHERE id = ?').run(id).changes > 0;
}