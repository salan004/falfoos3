/**
 * Roadmap #2 — TeamService.
 *
 * Owns the team abstraction for team-based tournaments (Team vs Team and 2v2):
 * initialization, random assignment, player-choice assignment, capacity
 * enforcement, membership lookup, locking, and DTO generation.
 *
 * Design notes:
 * - The canonical participant list is still `tournament_participants`; team
 *   membership is an additive relation in `tournament_team_members`.
 * - All mutations that must not race run inside a single better-sqlite3
 *   transaction. Capacity is enforced with a guarded conditional insert at the
 *   database level (never from a client-supplied count).
 * - Randomization uses `crypto.randomInt` (an unbiased Fisher–Yates shuffle),
 *   consistent with `BracketService`. Tests may inject a deterministic RNG.
 */

import { randomInt, randomUUID } from 'crypto';
import { getDb } from '../db/db';
import {
  getTournamentById,
  isTeamCompetition,
  type CompetitionType,
  type TournamentRow,
} from '../games/TournamentService';

export type TeamAssignedBy = 'random' | 'player' | 'admin';

export interface TeamRow {
  id: string;
  tournament_id: string;
  team_no: number;
  name_ar: string;
  capacity: number | null;
  created_at: number;
  updated_at: number;
}

export interface TeamMemberRow {
  tournament_id: string;
  team_id: string;
  player_id: string;
  joined_at: number;
  assigned_by: TeamAssignedBy;
}

export interface TeamMemberDto {
  playerId: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface TeamDto {
  id: string;
  teamNo: number;
  nameAr: string;
  capacity: number | null;
  memberCount: number;
  full: boolean;
  members: TeamMemberDto[];
}

export class TeamError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'TeamError';
  }
}

const DEFAULT_TEAM1_NAME = 'الفريق الأول';
const DEFAULT_TEAM2_NAME = 'الفريق الثاني';
const TWO_VS_TWO_CAPACITY = 2;

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export function getTeams(tournamentId: string): TeamRow[] {
  return getDb()
    .prepare('SELECT * FROM tournament_teams WHERE tournament_id = ? ORDER BY team_no ASC')
    .all(tournamentId) as TeamRow[];
}

export function getTeam(teamId: string): TeamRow | null {
  const row = getDb().prepare('SELECT * FROM tournament_teams WHERE id = ?').get(teamId) as
    | TeamRow
    | undefined;
  return row ?? null;
}

export function countTeams(tournamentId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM tournament_teams WHERE tournament_id = ?')
    .get(tournamentId) as { n: number };
  return row.n;
}

export function getTeamMemberRows(teamId: string): TeamMemberRow[] {
  return getDb()
    .prepare('SELECT * FROM tournament_team_members WHERE team_id = ? ORDER BY joined_at ASC')
    .all(teamId) as TeamMemberRow[];
}

/** Canonical player ids of a team, in join order. */
export function getTeamMembers(teamId: string): string[] {
  return getTeamMemberRows(teamId).map((r) => r.player_id);
}

/** Team membership (if any) of a player within one tournament. */
export function getPlayerTeam(tournamentId: string, playerId: string): TeamRow | null {
  const row = getDb()
    .prepare(
      `SELECT t.* FROM tournament_team_members m
         JOIN tournament_teams t ON t.id = m.team_id
        WHERE m.tournament_id = ? AND m.player_id = ?`
    )
    .get(tournamentId, playerId) as TeamRow | undefined;
  return row ?? null;
}

function guestProfiles(playerIds: string[]): Map<string, { displayName: string | null; avatarUrl: string | null }> {
  const map = new Map<string, { displayName: string | null; avatarUrl: string | null }>();
  if (playerIds.length === 0) return map;
  const placeholders = playerIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT player_id, display_name, avatar_url FROM guests WHERE player_id IN (${placeholders})`
    )
    .all(...playerIds) as { player_id: string; display_name: string | null; avatar_url: string | null }[];
  for (const r of rows) map.set(r.player_id, { displayName: r.display_name, avatarUrl: r.avatar_url });
  return map;
}

/**
 * Display name of a team. For Team vs Team the admin-configured tournament
 * names are authoritative (so name edits always show); 2v2 uses the stored
 * auto-generated `name_ar`.
 */
export function resolveTeamName(tournament: TournamentRow, team: TeamRow): string {
  if (tournament.competition_type === 'team_vs_team') {
    if (team.team_no === 1) return tournament.team1_name?.trim() || DEFAULT_TEAM1_NAME;
    return tournament.team2_name?.trim() || DEFAULT_TEAM2_NAME;
  }
  return team.name_ar || `الفريق ${team.team_no}`;
}

/** Read-only team projection with member identities for the client. */
export function getTeamsDto(tournamentId: string): TeamDto[] {
  const tournament = getTournamentById(tournamentId);
  if (!tournament) return [];
  const teams = getTeams(tournamentId);
  if (teams.length === 0) return [];

  const membersByTeam = new Map<string, TeamMemberRow[]>();
  for (const team of teams) membersByTeam.set(team.id, getTeamMemberRows(team.id));

  const allPlayerIds = [...new Set([...membersByTeam.values()].flat().map((m) => m.player_id))];
  const profiles = guestProfiles(allPlayerIds);

  return teams.map((team) => {
    const members = membersByTeam.get(team.id) ?? [];
    const profile = (playerId: string): TeamMemberDto => ({
      playerId,
      displayName: profiles.get(playerId)?.displayName ?? null,
      avatarUrl: profiles.get(playerId)?.avatarUrl ?? null,
    });
    const memberCount = members.length;
    return {
      id: team.id,
      teamNo: team.team_no,
      nameAr: resolveTeamName(tournament, team),
      capacity: team.capacity,
      memberCount,
      full: team.capacity !== null && memberCount >= team.capacity,
      members: members.map((m) => profile(m.player_id)),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Initialization                                                             */
/* -------------------------------------------------------------------------- */

interface TeamSeed {
  teamNo: number;
  nameAr: string;
  capacity: number | null;
}

function insertTeams(tournamentId: string, seeds: TeamSeed[]): void {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO tournament_teams (id, tournament_id, team_no, name_ar, capacity, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const seed of seeds) {
    stmt.run(randomUUID(), tournamentId, seed.teamNo, seed.nameAr, seed.capacity, now, now);
  }
}

/**
 * Creates the initial (empty) teams for a team tournament when none exist.
 * - Team vs Team: exactly two teams.
 * - 2v2 player-choice: `ceil(max_participants / 2)` teams (capacity 2).
 * - 2v2 random: no teams yet (created during random assignment, which knows the
 *   roster size).
 *
 * Idempotent and safe to call from creation/reads.
 */
export function ensureTeamsInitialized(tournamentId: string): void {
  const tournament = getTournamentById(tournamentId);
  if (!tournament) throw new TeamError('tournament_not_found', 'Tournament not found');
  if (!isTeamCompetition(tournament.competition_type)) return;
  if (countTeams(tournamentId) > 0) return;

  if (tournament.competition_type === 'team_vs_team') {
    insertTeams(tournamentId, [
      { teamNo: 1, nameAr: tournament.team1_name?.trim() || DEFAULT_TEAM1_NAME, capacity: null },
      { teamNo: 2, nameAr: tournament.team2_name?.trim() || DEFAULT_TEAM2_NAME, capacity: null },
    ]);
    return;
  }

  // two_vs_two
  if (tournament.team_formation === 'player_choice') {
    const max = tournament.max_participants ?? 0;
    const teamCount = Math.ceil(max / TWO_VS_TWO_CAPACITY);
    if (teamCount >= 1) {
      const seeds: TeamSeed[] = [];
      for (let i = 1; i <= teamCount; i++) {
        seeds.push({ teamNo: i, nameAr: `الفريق ${i}`, capacity: TWO_VS_TWO_CAPACITY });
      }
      insertTeams(tournamentId, seeds);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Locking                                                                    */
/* -------------------------------------------------------------------------- */

export function isTeamsLocked(tournamentId: string): boolean {
  const tournament = getTournamentById(tournamentId);
  return tournament?.teams_locked_at !== null && tournament?.teams_locked_at !== undefined;
}

/** Freezes team composition. Idempotent. */
export function lockTeams(tournamentId: string): void {
  const db = getDb();
  db.prepare(
    'UPDATE tournaments SET teams_locked_at = COALESCE(teams_locked_at, ?), updated_at = ? WHERE id = ?'
  ).run(Date.now(), Date.now(), tournamentId);
}

/* -------------------------------------------------------------------------- */
/* Random assignment                                                          */
/* -------------------------------------------------------------------------- */

export interface RandomAssignOptions {
  /** Test-only deterministic RNG: returns an integer in [0, maxExclusive). */
  randomInt?: (maxExclusive: number) => number;
}

function shuffle<T>(items: T[], randomIntExclusive: (maxExclusive: number) => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomIntExclusive(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) {
      throw new TeamError('bad_rng', `RNG returned an out-of-range value: ${j}`);
    }
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function eligibleParticipants(tournamentId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT player_id FROM tournament_participants
        WHERE tournament_id = ? AND status IN ('registered','confirmed')`
    )
    .all(tournamentId) as { player_id: string }[];
  return [...new Set(rows.map((r) => r.player_id))];
}

function insertMember(tournamentId: string, teamId: string, playerId: string, by: TeamAssignedBy): void {
  getDb()
    .prepare(
      `INSERT INTO tournament_team_members (tournament_id, team_id, player_id, joined_at, assigned_by)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(tournamentId, teamId, playerId, Date.now(), by);
}

/**
 * Randomly distributes registered participants into teams and persists the
 * result atomically. Blocked once teams are locked. Re-running before the lock
 * replaces the previous assignment.
 *
 * - Team vs Team: two teams, Team 1 = ceil(N/2), Team 2 = floor(N/2).
 * - 2v2: fresh teams of exactly two; an odd participant remains unassigned and
 *   is later rejected by `assertFormationComplete` at bracket generation.
 */
export function randomAssignTeams(tournamentId: string, options?: RandomAssignOptions): void {
  const db = getDb();
  const rng = options?.randomInt ?? ((max: number) => randomInt(max));

  const tx = db.transaction((): void => {
    const tournament = getTournamentById(tournamentId);
    if (!tournament) throw new TeamError('tournament_not_found', 'Tournament not found');
    if (!isTeamCompetition(tournament.competition_type)) {
      throw new TeamError('not_team_competition', 'Tournament is not a team competition');
    }
    if (tournament.teams_locked_at !== null) {
      throw new TeamError('teams_locked', 'Teams are already locked');
    }

    const players = shuffle(eligibleParticipants(tournamentId), rng);

    // Clear any previous assignment for this tournament (cascades members).
    db.prepare('DELETE FROM tournament_team_members WHERE tournament_id = ?').run(tournamentId);

    if (tournament.competition_type === 'team_vs_team') {
      ensureTeamsInitialized(tournamentId);
      const teams = getTeams(tournamentId);
      const team1 = teams.find((t) => t.team_no === 1)!;
      const team2 = teams.find((t) => t.team_no === 2)!;
      const half = Math.ceil(players.length / 2);
      players.slice(0, half).forEach((pid) => insertMember(tournamentId, team1.id, pid, 'random'));
      players.slice(half).forEach((pid) => insertMember(tournamentId, team2.id, pid, 'random'));
      return;
    }

    // two_vs_two — rebuild teams from the (possibly stale) team rows.
    db.prepare('DELETE FROM tournament_teams WHERE tournament_id = ?').run(tournamentId);
    const pairCount = Math.floor(players.length / TWO_VS_TWO_CAPACITY);
    const seeds: TeamSeed[] = [];
    for (let i = 1; i <= pairCount; i++) {
      seeds.push({ teamNo: i, nameAr: `الفريق ${i}`, capacity: TWO_VS_TWO_CAPACITY });
    }
    insertTeams(tournamentId, seeds);
    const teams = getTeams(tournamentId);
    for (let i = 0; i < pairCount; i++) {
      const team = teams[i];
      insertMember(tournamentId, team.id, players[i * 2], 'random');
      insertMember(tournamentId, team.id, players[i * 2 + 1], 'random');
    }
    // Odd participant intentionally left unassigned; bracket generation rejects.
  });

  tx();
}

/* -------------------------------------------------------------------------- */
/* Player-choice assignment                                                   */
/* -------------------------------------------------------------------------- */

export interface AssignPlayerResult {
  team: TeamDto;
  /** True when the player already belonged to the requested team. */
  idempotent: boolean;
  /** True when the player moved from another team in this tournament. */
  switched: boolean;
}

/**
 * Adds (or moves) a player to a team. Server-authoritative:
 * - the player must be a registered participant of the tournament;
 * - the tournament must be open and teams must not be locked;
 * - the team must belong to the tournament;
 * - capacity is enforced with a guarded conditional insert.
 */
export function assignPlayerToTeam(
  tournamentId: string,
  playerId: string,
  teamId: string,
  assignedBy: TeamAssignedBy = 'player'
): AssignPlayerResult {
  const db = getDb();

  const tx = db.transaction((): AssignPlayerResult => {
    const tournament = getTournamentById(tournamentId);
    if (!tournament) throw new TeamError('tournament_not_found', 'Tournament not found');
    if (!isTeamCompetition(tournament.competition_type)) {
      throw new TeamError('not_team_competition', 'Tournament is not a team competition');
    }
    if (tournament.status === 'cancelled') {
      throw new TeamError('tournament_cancelled', 'Tournament is cancelled');
    }
    if (tournament.status !== 'open') {
      throw new TeamError('tournament_not_open', 'Tournament is not open for team selection');
    }
    if (tournament.teams_locked_at !== null) {
      throw new TeamError('teams_locked', 'Teams are locked');
    }
    // Players may only self-select in a player-choice tournament; admins may
    // still correct an assignment (including in a random tournament) pre-lock.
    if (assignedBy !== 'admin' && tournament.team_formation !== 'player_choice') {
      throw new TeamError('formation_not_choice', 'This tournament uses random team assignment');
    }

    const participant = db
      .prepare(
        `SELECT status FROM tournament_participants
          WHERE tournament_id = ? AND player_id = ?`
      )
      .get(tournamentId, playerId) as { status: string } | undefined;
    if (!participant || (participant.status !== 'registered' && participant.status !== 'confirmed')) {
      throw new TeamError('not_registered', 'Player is not a registered participant');
    }

    const team = getTeam(teamId);
    if (!team || team.tournament_id !== tournamentId) {
      throw new TeamError('team_not_found', 'Team does not belong to this tournament');
    }

    const current = getPlayerTeam(tournamentId, playerId);
    if (current && current.id === teamId) {
      return { team: getTeamsDto(tournamentId).find((t) => t.id === teamId)!, idempotent: true, switched: false };
    }

    // Detach from any previous team before the guarded capacity insert so the
    // UNIQUE(tournament_id, player_id) constraint cannot cause a false "full".
    if (current) {
      db.prepare('DELETE FROM tournament_team_members WHERE tournament_id = ? AND player_id = ?').run(
        tournamentId,
        playerId
      );
    }

    if (team.capacity === null) {
      insertMember(tournamentId, team.id, playerId, assignedBy);
    } else {
      const inserted = db
        .prepare(
          `INSERT INTO tournament_team_members (tournament_id, team_id, player_id, joined_at, assigned_by)
           SELECT ?, ?, ?, ?, ?
           WHERE (SELECT COUNT(*) FROM tournament_team_members WHERE team_id = ?) < ?`
        )
        .run(tournamentId, team.id, playerId, Date.now(), assignedBy, team.id, team.capacity);
      if (inserted.changes === 0) {
        throw new TeamError('team_full', 'Team is full');
      }
    }

    return {
      team: getTeamsDto(tournamentId).find((t) => t.id === teamId)!,
      idempotent: false,
      switched: current !== null,
    };
  });

  return tx();
}

/* -------------------------------------------------------------------------- */
/* Completion validation                                                      */
/* -------------------------------------------------------------------------- */

export interface FormationValidation {
  complete: boolean;
  reason?: string;
}

/**
 * Validates that the persisted team composition is ready for bracket generation:
 * - every registered participant is assigned to exactly one team;
 * - 2v2 teams each hold exactly two players;
 * - Team vs Team has both teams non-empty.
 */
export function validateFormationComplete(tournamentId: string): FormationValidation {
  const tournament = getTournamentById(tournamentId);
  if (!tournament) return { complete: false, reason: 'tournament_not_found' };
  if (!isTeamCompetition(tournament.competition_type)) return { complete: true };

  const players = eligibleParticipants(tournamentId);
  const assigned = getDb()
    .prepare('SELECT player_id FROM tournament_team_members WHERE tournament_id = ?')
    .all(tournamentId) as { player_id: string }[];
  const assignedSet = new Set(assigned.map((r) => r.player_id));

  const unassigned = players.filter((p) => !assignedSet.has(p));
  if (unassigned.length > 0) {
    return { complete: false, reason: 'unassigned_players' };
  }

  const teams = getTeams(tournamentId);
  if (teams.length === 0) {
    return { complete: false, reason: 'no_teams' };
  }

  if (tournament.competition_type === 'two_vs_two') {
    for (const team of teams) {
      const size = getTeamMemberRows(team.id).length;
      if (size !== TWO_VS_TWO_CAPACITY) {
        return { complete: false, reason: 'incomplete_team' };
      }
    }
  } else {
    // team_vs_team — exactly two non-empty teams.
    if (teams.length !== 2) return { complete: false, reason: 'team_count' };
    for (const team of teams) {
      if (getTeamMemberRows(team.id).length === 0) {
        return { complete: false, reason: 'empty_team' };
      }
    }
  }

  return { complete: true };
}

/** Throws a `TeamError('team_formation_incomplete')` with an Arabic message. */
export function assertFormationComplete(tournamentId: string, competitionType: CompetitionType): void {
  const result = validateFormationComplete(tournamentId);
  if (result.complete) return;
  const arMessage =
    competitionType === 'two_vs_two'
      ? 'لا يمكن توليد الجدول: كل فريق في منافسة 2 ضد 2 يجب أن يضم لاعبين اثنين بالضبط، ويجب أن يكون جميع المسجلين موزعين على الفرق.'
      : 'لا يمكن توليد الجدول: يجب توزيع جميع المسجلين على الفريقين قبل بدء البطولة.';
  throw new TeamError('team_formation_incomplete', arMessage);
}
