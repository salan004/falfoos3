import { getDb } from '../db/db';
import crypto from 'crypto';

/**
 * Phase 3 — Tournaments data access.
 *
 * Roadmap #2 — competition configuration:
 * - `competition_type`: individual (legacy), team_vs_team, two_vs_two
 * - `team_formation`: random | player_choice (NULL for individual)
 * - `team1_name` / `team2_name`: admin custom names for Team vs Team
 * - `teams_locked_at`: set once team composition is frozen
 */

export type CompetitionType = 'individual' | 'team_vs_team' | 'two_vs_two';
export type TeamFormation = 'random' | 'player_choice';

export const COMPETITION_TYPES: readonly CompetitionType[] = [
  'individual',
  'team_vs_team',
  'two_vs_two',
];
export const TEAM_FORMATIONS: readonly TeamFormation[] = ['random', 'player_choice'];

/** True for competitions whose matches are contested by teams. */
export function isTeamCompetition(type: CompetitionType): boolean {
  return type === 'team_vs_team' || type === 'two_vs_two';
}

export interface TournamentRow {
  id: string;
  game_id: string;
  name_ar: string;
  description_ar: string | null;
  image_url: string | null;
  status: 'draft' | 'open' | 'active' | 'completed' | 'cancelled';
  max_participants: number | null;
  /** Optional configured Streamlabs Loyalty ticket price. NULL = legacy/default. */
  ticket_cost: number | null;
  /**
   * R5 — visibility, STRICTLY SEPARATE from `status`. NULL = visible. A hidden
   * tournament keeps its lifecycle status; it is only removed from normal
   * listings/discovery. Never used to delete data.
   */
  hidden_at: number | null;
  /** Admin user id that performed the last hide (audit only). */
  hidden_by: string | null;
  /** Roadmap #2 — competition type. Existing rows default to `individual`. */
  competition_type: CompetitionType;
  /** Roadmap #2 — team formation for team competitions; NULL for individual. */
  team_formation: TeamFormation | null;
  /** Roadmap #2 — custom Team 1 name (Team vs Team only). */
  team1_name: string | null;
  /** Roadmap #2 — custom Team 2 name (Team vs Team only). */
  team2_name: string | null;
  /** Roadmap #2 — set once team composition is frozen (bracket generation). */
  teams_locked_at: number | null;
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
  ticket_cost?: number | null;
  competition_type?: CompetitionType;
  team_formation?: TeamFormation | null;
  team1_name?: string | null;
  team2_name?: string | null;
  starts_at?: number;
  ends_at?: number;
  status?: 'draft' | 'open';
}

export interface UpdateTournamentInput {
  name_ar?: string;
  description_ar?: string;
  image_url?: string;
  max_participants?: number | null;
  ticket_cost?: number | null;
  competition_type?: CompetitionType;
  team_formation?: TeamFormation | null;
  team1_name?: string | null;
  team2_name?: string | null;
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
    ticket_cost: row.ticket_cost ?? null,
    hidden_at: row.hidden_at ?? null,
    hidden_by: row.hidden_by ?? null,
    competition_type: (row.competition_type as CompetitionType) ?? 'individual',
    team_formation: (row.team_formation as TeamFormation | null) ?? null,
    team1_name: row.team1_name ?? null,
    team2_name: row.team2_name ?? null,
    teams_locked_at: row.teams_locked_at ?? null,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Upper bound consistent with the project's integer-configured limits. */
export const MAX_TICKET_COST = 1_000_000;

/**
 * R4.1 — normalizes an admin-provided ticket cost.
 *
 * NULL / undefined / empty string → NULL (legacy/default bot pricing).
 * A whole number in [1, MAX_TICKET_COST] → that integer.
 * Anything else (0, negative, decimal, NaN, non-numeric string, too large)
 * is rejected — prices are never silently rounded.
 */
export function validateTicketCost(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error('Ticket cost must be a whole number of loyalty points');
  }
  if (n < 1) {
    throw new Error('Ticket cost must be at least 1 loyalty point');
  }
  if (n > MAX_TICKET_COST) {
    throw new Error(`Ticket cost must be at most ${MAX_TICKET_COST} loyalty points`);
  }
  return n;
}

function validateTournamentName(nameAr: string): void {
  if (!nameAr || !nameAr.trim()) {
    throw new Error('Tournament name is required');
  }
  if (nameAr.length > 150) {
    throw new Error('Tournament name must be 150 characters or less');
  }
}

const MAX_TEAM_NAME = 60;

function normalizeTeamName(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_TEAM_NAME) {
    throw new Error(`${label} must be ${MAX_TEAM_NAME} characters or less`);
  }
  return trimmed;
}

export function validateCompetitionType(value: unknown): CompetitionType {
  if (value === undefined || value === null || value === '') return 'individual';
  if (typeof value !== 'string' || !COMPETITION_TYPES.includes(value as CompetitionType)) {
    throw new Error('Invalid competition type');
  }
  return value as CompetitionType;
}

function optionalTeamFormation(value: unknown): TeamFormation | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !TEAM_FORMATIONS.includes(value as TeamFormation)) {
    throw new Error('Invalid team formation');
  }
  return value as TeamFormation;
}

/**
 * Roadmap #2 — validates the effective competition configuration as a whole.
 * Rejects invalid combinations server-side (never trust the Admin UI).
 */
interface CompetitionConfig {
  competitionType: CompetitionType;
  teamFormation: TeamFormation | null;
  team1Name: string | null;
  team2Name: string | null;
  maxParticipants: number | null;
}

function validateCompetitionConfig(config: CompetitionConfig): void {
  const { competitionType, teamFormation, team1Name, team2Name, maxParticipants } = config;

  if (competitionType === 'individual') {
    if (teamFormation !== null) throw new Error('Individual tournaments cannot have a team formation');
    if (team1Name !== null || team2Name !== null) {
      throw new Error('Individual tournaments cannot have team names');
    }
    return;
  }

  // team_vs_team / two_vs_two
  if (teamFormation === null) {
    throw new Error('Team tournaments require a team formation (random or player_choice)');
  }

  if (competitionType === 'two_vs_two') {
    if (team1Name !== null || team2Name !== null) {
      throw new Error('2v2 tournaments use automatic team names');
    }
    if (teamFormation === 'player_choice' && (maxParticipants === null || maxParticipants < 2)) {
      throw new Error('2v2 player-choice tournaments require max participants of at least 2');
    }
  }
}

/**
 * R2 — logical tournament name for uniqueness/rename comparisons. Legacy rows
 * may carry leading/trailing whitespace while the admin UI submits the trimmed
 * value, so raw inequality would falsely report a rename. Stored values are
 * never mutated by this helper.
 */
function normalizeTournamentName(nameAr: string): string {
  return nameAr.trim();
}

/** Characters stripped from both ends when matching a logical name (no user input). */
const TOURNAMENT_NAME_TRIM_CHARS = "char(32) || char(9) || char(10) || char(13)";

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

/**
 * R5 — visibility selector for tournament listings.
 *
 * `'visible'` (default) excludes hidden tournaments; `'hidden'` returns only
 * hidden ones; `'all'` returns everything. Every LISTING query defaults to
 * `'visible'` so hidden tournaments disappear from normal surfaces, while
 * detail/read-by-id and player history stay unfiltered (accessible).
 */
export type TournamentVisibility = 'visible' | 'hidden' | 'all';

/** SQL predicate fragment (no user input) for a given visibility, per alias. */
function visibilityPredicate(visibility: TournamentVisibility, column: string): string {
  if (visibility === 'hidden') return `${column} IS NOT NULL`;
  if (visibility === 'all') return '';
  return `${column} IS NULL`;
}

export function getAllTournaments(options?: { visibility?: TournamentVisibility }): TournamentRow[] {
  const db = getDb();
  const visibility = options?.visibility ?? 'visible';
  const clause = visibilityPredicate(visibility, 'hidden_at');
  const rows = db
    .prepare(`SELECT * FROM tournaments ${clause ? `WHERE ${clause}` : ''} ORDER BY created_at DESC`)
    .all();
  return rows.map(rowToTournament);
}

export function getTournamentsByGame(
  gameId: string,
  options?: { visibility?: TournamentVisibility }
): TournamentRow[] {
  const db = getDb();
  const visibility = options?.visibility ?? 'visible';
  const clause = visibilityPredicate(visibility, 'hidden_at');
  const rows = db
    .prepare(
      `SELECT * FROM tournaments WHERE game_id = ? ${clause ? `AND ${clause}` : ''} ORDER BY created_at DESC`
    )
    .all(gameId);
  return rows.map(rowToTournament);
}

export function getActiveTournaments(options?: { visibility?: TournamentVisibility }): TournamentRow[] {
  const db = getDb();
  const visibility = options?.visibility ?? 'visible';
  const clause = visibilityPredicate(visibility, 'hidden_at');
  const rows = db
    .prepare(
      `SELECT * FROM tournaments WHERE status IN ('open','active') ${clause ? `AND ${clause}` : ''} ORDER BY starts_at ASC`
    )
    .all();
  return rows.map(rowToTournament);
}

export function getTournamentsWithGameInfo(options?: {
  visibility?: TournamentVisibility;
}): TournamentWithGame[] {
  const db = getDb();
  const visibility = options?.visibility ?? 'visible';
  const clause = visibilityPredicate(visibility, 't.hidden_at');
  const rows = db.prepare(`
    SELECT t.*, g.name_ar as game_name_ar, g.slug as game_slug, g.image_url as game_image_url,
           (SELECT COUNT(*) FROM tournament_participants
             WHERE tournament_id = t.id AND status IN ('registered','confirmed')) as participant_count
    FROM tournaments t
    JOIN games g ON g.id = t.game_id
    ${clause ? `WHERE ${clause}` : ''}
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

  // R2 — reject a duplicate LOGICAL tournament name (whitespace-normalized),
  // matching the update rule and the games convention. Legacy padded rows are
  // matched too, so a trimmed duplicate can never be introduced.
  const duplicateName = db
    .prepare(`SELECT id FROM tournaments WHERE TRIM(name_ar, ${TOURNAMENT_NAME_TRIM_CHARS}) = ?`)
    .get(normalizeTournamentName(input.name_ar));
  if (duplicateName) {
    throw new Error(`Tournament name '${input.name_ar}' already exists`);
  }

  const status = input.status ?? 'draft';
  if (status !== 'draft' && status !== 'open') {
    throw new Error('Initial status must be draft or open');
  }

  const ticketCost = validateTicketCost(input.ticket_cost);

  // Roadmap #2 — competition configuration (validated as a whole).
  const competitionType = validateCompetitionType(input.competition_type);
  const teamFormation = optionalTeamFormation(input.team_formation);
  const team1Name = normalizeTeamName(input.team1_name, 'Team 1 name');
  const team2Name = normalizeTeamName(input.team2_name, 'Team 2 name');
  const maxParticipants = input.max_participants ?? null;
  validateCompetitionConfig({
    competitionType,
    teamFormation,
    team1Name,
    team2Name,
    maxParticipants,
  });

  const effectiveTeam1 = competitionType === 'team_vs_team' ? team1Name : null;
  const effectiveTeam2 = competitionType === 'team_vs_team' ? team2Name : null;

  const id = crypto.randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO tournaments (id, game_id, name_ar, description_ar, image_url, status, max_participants, ticket_cost,
                             competition_type, team_formation, team1_name, team2_name,
                             starts_at, ends_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.game_id,
    input.name_ar,
    input.description_ar ?? null,
    input.image_url ?? null,
    status,
    maxParticipants,
    ticketCost,
    competitionType,
    teamFormation,
    effectiveTeam1,
    effectiveTeam2,
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
    // R2 — only enforce uniqueness when the LOGICAL name changes. A legacy
    // stored name with leading/trailing whitespace is not a rename when the
    // admin submits the trimmed equivalent. Renaming to a name owned by another
    // tournament is still rejected (normalized lookup).
    const normalizedInput = normalizeTournamentName(input.name_ar);
    if (normalizedInput !== normalizeTournamentName(existing.name_ar)) {
      const dup = db
        .prepare(
          `SELECT id FROM tournaments WHERE TRIM(name_ar, ${TOURNAMENT_NAME_TRIM_CHARS}) = ? AND id != ?`
        )
        .get(normalizedInput, id);
      if (dup) {
        throw new Error(`Tournament name '${input.name_ar}' already exists`);
      }
    }
  }

  if (input.status !== undefined && input.status !== existing.status) {
    validateStatusTransition(existing.status, input.status);
  }

  if (input.max_participants !== undefined && input.max_participants !== null && input.max_participants < 1) {
    throw new Error('Maximum participants must be at least 1');
  }

  // Roadmap #2 — competition configuration. `undefined` preserves the stored
  // value. Changing the competition/formation is blocked once teams exist or
  // are locked, and only while the tournament is draft/open.
  const requestedCompetition =
    input.competition_type !== undefined ? validateCompetitionType(input.competition_type) : undefined;
  const requestedFormation =
    input.team_formation !== undefined ? optionalTeamFormation(input.team_formation) : undefined;
  const requestedTeam1 =
    input.team1_name !== undefined ? normalizeTeamName(input.team1_name, 'Team 1 name') : undefined;
  const requestedTeam2 =
    input.team2_name !== undefined ? normalizeTeamName(input.team2_name, 'Team 2 name') : undefined;

  const effectiveCompetition = requestedCompetition ?? existing.competition_type;
  const effectiveFormation =
    requestedFormation !== undefined ? requestedFormation : existing.team_formation;
  const effectiveTeam1 = requestedTeam1 !== undefined ? requestedTeam1 : existing.team1_name;
  const effectiveTeam2 = requestedTeam2 !== undefined ? requestedTeam2 : existing.team2_name;
  const effectiveMax = input.max_participants !== undefined ? input.max_participants : existing.max_participants;

  const competitionChanging =
    (requestedCompetition !== undefined && requestedCompetition !== existing.competition_type) ||
    (requestedFormation !== undefined && requestedFormation !== existing.team_formation);

  if (competitionChanging) {
    const teamsExist = (
      db.prepare('SELECT COUNT(*) AS n FROM tournament_teams WHERE tournament_id = ?').get(id) as { n: number }
    ).n;
    if (existing.teams_locked_at !== null) {
      throw new Error('Cannot change competition after teams are locked');
    }
    if (teamsExist > 0) {
      throw new Error('Cannot change competition after teams have been created');
    }
    if (existing.status !== 'draft' && existing.status !== 'open') {
      throw new Error('Competition can only be changed while draft or open');
    }
  }

  validateCompetitionConfig({
    competitionType: effectiveCompetition,
    teamFormation: effectiveCompetition === 'individual' ? null : effectiveFormation,
    team1Name: effectiveCompetition === 'team_vs_team' ? effectiveTeam1 : null,
    team2Name: effectiveCompetition === 'team_vs_team' ? effectiveTeam2 : null,
    maxParticipants: effectiveMax,
  });

  // R4.1 — validate (and normalize) the ticket cost when explicitly supplied.
  // `undefined` preserves the stored value; `null`/empty clears it.
  const ticketCost = input.ticket_cost !== undefined ? validateTicketCost(input.ticket_cost) : undefined;

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
  if (ticketCost !== undefined) {
    updates.push('ticket_cost = ?');
    params.push(ticketCost);
  }
  if (
    requestedCompetition !== undefined ||
    requestedFormation !== undefined ||
    requestedTeam1 !== undefined ||
    requestedTeam2 !== undefined
  ) {
    const finalType = effectiveCompetition;
    updates.push('competition_type = ?');
    params.push(finalType);
    updates.push('team_formation = ?');
    params.push(finalType === 'individual' ? null : effectiveFormation);
    updates.push('team1_name = ?');
    params.push(finalType === 'team_vs_team' ? effectiveTeam1 : null);
    updates.push('team2_name = ?');
    params.push(finalType === 'team_vs_team' ? effectiveTeam2 : null);
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

export interface SetTournamentHiddenResult {
  tournament: TournamentRow;
  /** False when the tournament was already in the requested state (idempotent). */
  changed: boolean;
}

/**
 * R5 — the ONLY visibility mutation. Sets or clears `hidden_at`/`hidden_by`.
 *
 * Hard guarantees:
 * - NEVER touches `status` (lifecycle and visibility are independent).
 * - NEVER deletes any row (tournament-owned or otherwise).
 * - Reversible and idempotent.
 *
 * Returns null when the tournament does not exist.
 */
export function setTournamentHidden(
  id: string,
  hidden: boolean,
  actorId?: string | null
): SetTournamentHiddenResult | null {
  const db = getDb();
  const existing = getTournamentById(id);
  if (!existing) return null;

  const alreadyHidden = existing.hidden_at !== null;
  if (alreadyHidden === hidden) {
    return { tournament: existing, changed: false };
  }

  const now = Date.now();
  if (hidden) {
    db.prepare('UPDATE tournaments SET hidden_at = ?, hidden_by = ?, updated_at = ? WHERE id = ?').run(
      now,
      actorId ?? null,
      now,
      id
    );
  } else {
    db.prepare('UPDATE tournaments SET hidden_at = NULL, hidden_by = NULL, updated_at = ? WHERE id = ?').run(
      now,
      id
    );
  }

  const tournament = getTournamentById(id);
  if (!tournament) {
    throw new Error('Failed to retrieve tournament after visibility change');
  }
  return { tournament, changed: true };
}