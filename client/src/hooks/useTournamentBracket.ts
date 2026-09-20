import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onCompetitiveEvent } from '../utils/socket';
import type { BracketPlayerMeta } from '../components/BracketView';
import type {
  BracketDto,
  CompetitiveRosterEntry,
  GameLeaderboardEntry,
  MatchDto,
  TournamentSummary,
} from '../types/competitive';
import {
  fetchTournamentSummary,
  fetchTournamentRoster,
  fetchTournamentBracket,
  fetchTournamentMatches,
  fetchGameLeaderboard,
} from '../utils/competitiveApi';

export interface TournamentBracketData {
  summary: TournamentSummary | null;
  roster: CompetitiveRosterEntry[];
  bracket: BracketDto | null;
  matches: MatchDto[];
  profiles: Map<string, GameLeaderboardEntry>;
  playerMeta: Map<string, BracketPlayerMeta>;
  roundNames: Map<number, string>;
  participantRecords: Map<string, { wins: number; losses: number }>;
  championPlayerId: string | null;
  championMeta: BracketPlayerMeta | undefined;
  loading: boolean;
  error: string | null;
  /** Bumped on every successful (re)load — useful for broadcast "live" cues. */
  updatedAt: number;
  reload: () => Promise<void>;
}

/**
 * Post-Phase 8 — the SINGLE data source for a tournament bracket.
 *
 * Both the normal Tournament Detail page and the Broadcast Bracket consume this
 * hook, so they render the exact same matches/results/progression from the
 * existing public tournament APIs. Nothing competitive is computed here: the
 * server remains authoritative and this hook only moves DTOs.
 *
 * Real-time invalidation: server events are refetch signals only.
 */
export function useTournamentBracket(tournamentId: string): TournamentBracketData {
  const [summary, setSummary] = useState<TournamentSummary | null>(null);
  const [roster, setRoster] = useState<CompetitiveRosterEntry[]>([]);
  const [bracket, setBracket] = useState<BracketDto | null>(null);
  const [matches, setMatches] = useState<MatchDto[]>([]);
  const [profiles, setProfiles] = useState<Map<string, GameLeaderboardEntry>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    const summaryRes = await fetchTournamentSummary(tournamentId);
    if (!summaryRes.ok || !summaryRes.data) {
      setError(summaryRes.status === 404 ? 'البطولة غير موجودة' : 'فشل تحميل البطولة');
      setLoading(false);
      return;
    }
    const summaryData = summaryRes.data.tournament;
    setSummary(summaryData);

    const [rosterRes, bracketRes, matchesRes, leaderboardRes] = await Promise.all([
      fetchTournamentRoster(tournamentId),
      fetchTournamentBracket(tournamentId),
      fetchTournamentMatches(tournamentId),
      fetchGameLeaderboard(summaryData.gameId),
    ]);

    setRoster(rosterRes.data?.participants ?? []);
    setBracket(bracketRes.data?.bracket ?? null);
    setMatches(matchesRes.data?.matches ?? []);

    const map = new Map<string, GameLeaderboardEntry>();
    for (const entry of leaderboardRes.data?.leaderboard.players ?? []) {
      map.set(entry.playerId, entry);
    }
    setProfiles(map);
    setUpdatedAt(Date.now());
    setLoading(false);
  }, [tournamentId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Phase 4F — real-time invalidation, debounced so a burst results in one refetch.
  const reloadTimer = useRef<number | null>(null);
  useEffect(() => {
    const off = onCompetitiveEvent((event) => {
      const relevant =
        event.tournamentId === tournamentId ||
        (event.type === 'competitive_profile.updated' && event.gameId === summary?.gameId);
      if (!relevant) return;
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => {
        reloadTimer.current = null;
        void load();
      }, 250);
    });
    return () => {
      off();
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    };
  }, [tournamentId, summary?.gameId, load]);

  const playerMeta = useMemo(() => {
    const map = new Map<string, BracketPlayerMeta>();
    for (const entry of roster) {
      map.set(entry.playerId, {
        name: entry.displayName ?? 'لاعب',
        avatarUrl: entry.avatarUrl,
        seed: entry.seed,
        rankName: entry.rank?.rankName ?? null,
        tierKey: entry.rank?.tierKey ?? null,
        lp: entry.lp ?? null,
        elo: entry.elo ?? null,
      });
    }
    for (const [playerId, profile] of profiles) {
      const existing = map.get(playerId);
      map.set(playerId, {
        name: existing?.name ?? profile.displayName ?? 'لاعب',
        avatarUrl: existing?.avatarUrl ?? profile.avatarUrl,
        seed: existing?.seed ?? null,
        rankName: profile.rank.rankName ?? existing?.rankName ?? null,
        tierKey: profile.rank.tierKey ?? existing?.tierKey ?? null,
        lp: profile.lp ?? existing?.lp ?? null,
        elo: profile.elo ?? existing?.elo ?? null,
      });
    }
    return map;
  }, [roster, profiles]);

  const roundNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const round of bracket?.rounds ?? []) map.set(round.roundNo, round.nameAr);
    return map;
  }, [bracket]);

  const participantRecords = useMemo(() => {
    const records = new Map<string, { wins: number; losses: number }>();
    const ensure = (playerId: string) => {
      let rec = records.get(playerId);
      if (!rec) {
        rec = { wins: 0, losses: 0 };
        records.set(playerId, rec);
      }
      return rec;
    };
    for (const match of matches) {
      if (match.status !== 'completed') continue;
      for (const p of match.players) {
        const rec = ensure(p.playerId);
        if (match.winnerPlayerId === null) continue;
        if (match.winnerPlayerId === p.playerId) rec.wins += 1;
        else rec.losses += 1;
      }
    }
    return records;
  }, [matches]);

  const championPlayerId = summary?.championPlayerId ?? null;
  const championMeta = championPlayerId ? playerMeta.get(championPlayerId) : undefined;

  return {
    summary,
    roster,
    bracket,
    matches,
    profiles,
    playerMeta,
    roundNames,
    participantRecords,
    championPlayerId,
    championMeta,
    loading,
    error,
    updatedAt,
    reload: load,
  };
}
