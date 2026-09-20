import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../utils/api';
import { useHashRoute } from '../hooks/useHashRoute';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { ArenaAtmosphere } from '../components/ArenaAtmosphere';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { RankBadge } from '../components/RankBadge';
import { RankProgress } from '../components/RankProgress';
import type {
  CompetitiveRosterEntry,
  PlayerCompetitiveProfile,
  PlayerTournamentState,
  TournamentSummary,
} from '../types/competitive';
import {
  fetchPlayerCompetitiveProfiles,
  fetchPlayerTournaments,
  fetchTournamentPlayerState,
  fetchTournamentRoster,
  fetchTournamentSummary,
} from '../utils/competitiveApi';

/**
 * Phase 1D — dedicated COMPETITIVE player statistics page (`#/player/:playerId`).
 *
 * Distinct from the general FalFoos profile (`#/profile/:playerId`, points /
 * level / achievements). This page is server-authoritative and read-only:
 * LP/Elo/rank/W-L/D all come from the competitive API (never calculated here).
 * When opened from a tournament it pins the tournament's game and adds a
 * tournament-specific section. The general profile is untouched.
 */
interface PlayerStatsPageProps {
  playerId: string;
  tournamentId?: string;
  gameId?: string;
}

const TOURNAMENT_STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  open: 'التسجيل مفتوح',
  active: 'جارية',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

const TOURNAMENT_STATUS_BADGE: Record<string, string> = {
  draft: 'badge-cyan',
  open: 'badge-green',
  active: 'badge-yellow',
  completed: 'badge-cyan',
  cancelled: 'badge-red',
};

const PARTICIPANT_STATUS_LABELS: Record<string, string> = {
  registered: 'مسجّل',
  confirmed: 'مؤكّد',
  cancelled: 'ملغى',
  disqualified: 'مستبعد',
};

export function PlayerStatsPage({ playerId, tournamentId, gameId }: PlayerStatsPageProps) {
  const { navigate } = useHashRoute();
  const headerRef = useScrollReveal<HTMLDivElement>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [identity, setIdentity] = useState<{ displayName: string; avatarUrl: string | null } | null>(null);
  const [profiles, setProfiles] = useState<PlayerCompetitiveProfile[]>([]);
  const [history, setHistory] = useState<PlayerTournamentState[]>([]);
  const [historyNames, setHistoryNames] = useState<Record<string, TournamentSummary>>({});

  const [selectedGameId, setSelectedGameId] = useState<string>(gameId ?? '');
  const [tournamentSummary, setTournamentSummary] = useState<TournamentSummary | null>(null);
  const [tournamentState, setTournamentState] = useState<PlayerTournamentState | null>(null);
  const [rosterEntry, setRosterEntry] = useState<CompetitiveRosterEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
    // Identity / existence comes from the existing general profile endpoint
    // (404 ⇒ unknown player); competitive data comes from the competitive API.
    const [profilesRes, historyRes, identityRes] = await Promise.all([
      fetchPlayerCompetitiveProfiles(playerId),
      fetchPlayerTournaments(playerId),
      apiFetch(`/api/players/${encodeURIComponent(playerId)}/profile`),
    ]);

    if (identityRes.status === 404) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    let resolvedIdentity: { displayName: string; avatarUrl: string | null } | null = null;
    if (identityRes.ok) {
      const body = (await identityRes.json().catch(() => null)) as
        | { profile?: { player?: { displayName?: string; avatarUrl?: string | null } } }
        | null;
      const p = body?.profile?.player;
      if (p?.displayName) resolvedIdentity = { displayName: p.displayName, avatarUrl: p.avatarUrl ?? null };
    }

    const playerProfiles = profilesRes.data?.profiles ?? [];
    const playerHistory = historyRes.data?.states ?? [];
    setProfiles(playerProfiles);
    setHistory(playerHistory);

    let summary: TournamentSummary | null = null;
    if (tournamentId) {
      const [summaryRes, stateRes] = await Promise.all([
        fetchTournamentSummary(tournamentId),
        fetchTournamentPlayerState(tournamentId, playerId),
      ]);
      summary = summaryRes.data?.tournament ?? null;
      setTournamentSummary(summary);
      setTournamentState(stateRes.data?.state ?? null);

      if (summary) {
        const rosterRes = await fetchTournamentRoster(tournamentId);
        const entry = rosterRes.data?.participants.find((e) => e.playerId === playerId) ?? null;
        setRosterEntry(entry);
        if (entry?.displayName) {
          resolvedIdentity = { displayName: entry.displayName, avatarUrl: entry.avatarUrl ?? null };
        }
      }
    } else {
      setTournamentSummary(null);
      setTournamentState(null);
      setRosterEntry(null);
    }

    if (resolvedIdentity) setIdentity(resolvedIdentity);

    const contextGame =
      gameId ?? summary?.gameId ?? (playerProfiles.length === 1 ? playerProfiles[0].gameId : '');
    setSelectedGameId((prev) => prev || contextGame || playerProfiles[0]?.gameId || '');

    setLoading(false);
    } catch {
      setError('تعذّر تحميل إحصائيات اللاعب');
      setLoading(false);
    }
  }, [playerId, tournamentId, gameId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Resolve tournament names for the (bounded) history list.
  useEffect(() => {
    let cancelled = false;
    const ids = history
      .map((s) => s.tournamentId)
      .filter((id) => id !== tournamentId)
      .slice(0, 8);
    if (ids.length === 0) {
      setHistoryNames({});
      return;
    }
    Promise.all(ids.map((id) => fetchTournamentSummary(id)))
      .then((results) => {
        if (cancelled) return;
        const map: Record<string, TournamentSummary> = {};
        for (const r of results) {
          if (r.data?.tournament) map[r.data.tournament.id] = r.data.tournament;
        }
        setHistoryNames(map);
      })
      .catch(() => {
        /* names are optional; rows still render with ids */
      });
    return () => {
      cancelled = true;
    };
  }, [history, tournamentId]);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.gameId === selectedGameId) ?? null,
    [profiles, selectedGameId]
  );

  const backTarget = tournamentId
    ? `/tournaments/${tournamentId}`
    : gameId
      ? `/stream-games/${gameId}`
      : '/stream-games';

  if (loading) {
    return (
      <main className="page">
        <div className="panel text-center py-12 loading-pulse text-[var(--text-dim)]">جارٍ تحميل إحصائيات اللاعب…</div>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="page">
        <div className="panel text-center py-12">
          <h2 className="page-title" style={{ fontSize: '1.4rem' }}>اللاعب غير موجود</h2>
          <p className="hero-subtitle">تحقّق من الرابط أو عُد إلى البطولة.</p>
          <button className="btn-neon mt-4" onClick={() => navigate(backTarget)}>← رجوع</button>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page">
        <div className="panel text-center py-12">
          <div className="text-[var(--text-dim)]">{error}</div>
          <button className="btn-neon mt-4" onClick={() => void load()}>إعادة المحاولة</button>
        </div>
      </main>
    );
  }

  const winRate =
    selectedProfile && selectedProfile.matchesPlayed > 0
      ? Math.round((selectedProfile.wins / selectedProfile.matchesPlayed) * 100)
      : null;

  const otherTournaments = history.filter((s) => s.tournamentId !== tournamentId);

  return (
    <main className="page">
      <ArenaAtmosphere />

      {/* ---------- Identity header ---------- */}
      <div ref={headerRef} className="reveal" style={{ textAlign: 'center', padding: '28px 0 12px' }}>
        <div className="brand-kicker">📊 الملف التنافسي</div>
        <div className="flex items-center justify-center gap-4 flex-wrap mt-3">
          <PlayerAvatar
            id={playerId}
            name={identity?.displayName ?? 'لاعب'}
            avatarUrl={identity?.avatarUrl ?? undefined}
            size={72}
          />
          <div style={{ textAlign: 'start' }}>
            <h1 className="hero-title" style={{ fontSize: '1.8rem', margin: 0 }}>
              {identity?.displayName ?? 'لاعب'}
            </h1>
            {selectedProfile && (
              <>
                <div className="rank-display rank-progress-header" style={{ '--rank-display-size': '76px' } as React.CSSProperties}>
                  <RankBadge tierKey={selectedProfile.rank.tierKey} label={selectedProfile.rank.rankName} size={76} />
                  <span className="rank-display-name">{selectedProfile.rank.rankName}</span>
                  {tournamentSummary && <span className="badge badge-gold">🎮 {tournamentSummary.gameNameAr}</span>}
                </div>
                <RankProgress rank={selectedProfile.rank} className="rank-progress-header" />
              </>
            )}
          </div>
        </div>
        <div className="mt-4">
          <button className="btn-neon text-sm" onClick={() => navigate(backTarget)}>← رجوع</button>
        </div>
      </div>

      {/* ---------- Game selector (only when the player has multiple games) ---------- */}
      {profiles.length > 1 && (
        <div className="panel mb-6">
          <div className="text-sm text-[var(--text-dim)] mb-2">اللعبة:</div>
          <div className="flex gap-2 flex-wrap">
            {profiles.map((p) => (
              <button
                key={p.gameId}
                type="button"
                className={p.gameId === selectedGameId ? 'btn-solid-cyan text-sm' : 'btn-neon text-sm'}
                onClick={() => setSelectedGameId(p.gameId)}
              >
                {p.gameNameAr ?? p.gameId}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---------- Competitive statistics (selected game) ---------- */}
      <section className="mb-10">
        <h2 className="section-title" style={{ textAlign: 'center', marginBottom: 16 }}>الإحصائيات التنافسية</h2>
        {!selectedProfile ? (
          <div className="panel text-center py-12 text-[var(--text-dim)]">
            لا توجد إحصائيات تنافسية متاحة لهذا اللاعب
          </div>
        ) : (
          <div className="competitive-stats-row">
            <div className="panel competitive-stat-card">
              <div className="competitive-stat-value">{selectedProfile.lp.toLocaleString('ar')}</div>
              <div className="competitive-stat-label">LP</div>
            </div>
            <div className="panel competitive-stat-card">
              <div className="competitive-stat-value">{selectedProfile.elo.toLocaleString('ar')}</div>
              <div className="competitive-stat-label">Elo</div>
            </div>
            <div className="panel competitive-stat-card">
              <div className="competitive-stat-value">{selectedProfile.matchesPlayed.toLocaleString('ar')}</div>
              <div className="competitive-stat-label">مباريات</div>
            </div>
            <div className="panel competitive-stat-card">
              <div className="competitive-stat-value">{selectedProfile.wins.toLocaleString('ar')}</div>
              <div className="competitive-stat-label">انتصارات</div>
            </div>
            <div className="panel competitive-stat-card">
              <div className="competitive-stat-value">{selectedProfile.losses.toLocaleString('ar')}</div>
              <div className="competitive-stat-label">خسائر</div>
            </div>
            <div className="panel competitive-stat-card">
              <div className="competitive-stat-value">{selectedProfile.draws.toLocaleString('ar')}</div>
              <div className="competitive-stat-label">تعادلات</div>
            </div>
            <div className="panel competitive-stat-card">
              <div className="competitive-stat-value">{winRate === null ? '—' : `${winRate.toLocaleString('ar')}%`}</div>
              <div className="competitive-stat-label">نسبة الفوز</div>
            </div>
          </div>
        )}
      </section>

      {/* ---------- Tournament-specific section ---------- */}
      {tournamentId && tournamentState && (
        <section className="mb-10">
          <h2 className="section-title" style={{ textAlign: 'center', marginBottom: 16 }}>إحصائياته في هذه البطولة</h2>
          <div className="panel tournament-stats-panel" style={{ marginBottom: 18 }}>
            {tournamentSummary && (
              <div className="text-center mb-3">
                <span className={`badge ${TOURNAMENT_STATUS_BADGE[tournamentSummary.status] ?? 'badge-cyan'}`}>
                  {TOURNAMENT_STATUS_LABELS[tournamentSummary.status] ?? tournamentSummary.status}
                </span>
              </div>
            )}
            <div className="tournament-stats-row">
              <div className="tournament-stat">
                <div className="tournament-stat-value">
                  {tournamentState.participantStatus
                    ? PARTICIPANT_STATUS_LABELS[tournamentState.participantStatus] ?? tournamentState.participantStatus
                    : '—'}
                </div>
                <div className="tournament-stat-label">حالة المشاركة</div>
              </div>
              <div className="tournament-stat">
                <div className="tournament-stat-value">{tournamentState.completedMatches.toLocaleString('ar')}</div>
                <div className="tournament-stat-label">مباريات مكتملة</div>
              </div>
              <div className="tournament-stat">
                <div className="tournament-stat-value">{tournamentState.wins.toLocaleString('ar')}</div>
                <div className="tournament-stat-label">فوز</div>
              </div>
              <div className="tournament-stat">
                <div className="tournament-stat-value">{tournamentState.losses.toLocaleString('ar')}</div>
                <div className="tournament-stat-label">خسارة</div>
              </div>
              <div className="tournament-stat">
                <div className="tournament-stat-value">{tournamentState.draws.toLocaleString('ar')}</div>
                <div className="tournament-stat-label">تعادل</div>
              </div>
              {typeof tournamentState.seed === 'number' && (
                <div className="tournament-stat">
                  <div className="tournament-stat-value">#{tournamentState.seed.toLocaleString('ar')}</div>
                  <div className="tournament-stat-label">Seed</div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-center gap-2 flex-wrap mt-3">
              {tournamentState.champion && <span className="badge badge-gold">🏆 البطل</span>}
              {!tournamentState.champion && tournamentState.eliminated && <span className="badge badge-red">مُقصى</span>}
              {!tournamentState.champion && !tournamentState.eliminated && tournamentState.advanced && (
                <span className="badge badge-green">متأهل</span>
              )}
              {rosterEntry?.rank && (
                <span className="badge badge-cyan">
                  <RankBadge tierKey={rosterEntry.rank.tierKey} label={rosterEntry.rank.rankName} size={14} />
                  {' '}{rosterEntry.rank.rankName}
                </span>
              )}
              {typeof rosterEntry?.lp === 'number' && <span className="badge badge-cyan">{rosterEntry.lp.toLocaleString('ar')} LP</span>}
              {typeof rosterEntry?.elo === 'number' && <span className="badge badge-cyan">Elo {rosterEntry.elo.toLocaleString('ar')}</span>}
            </div>
          </div>
        </section>
      )}

      {/* ---------- Tournament history ---------- */}
      <section className="mb-16">
        <h2 className="section-title" style={{ textAlign: 'center', marginBottom: 16 }}>سجل البطولات</h2>
        {otherTournaments.length === 0 ? (
          <div className="panel text-center py-12 text-[var(--text-dim)]">لا توجد بطولات أخرى مسجّلة لهذا اللاعب</div>
        ) : (
          <div className="panel" style={{ padding: '6px 14px' }}>
            <div className="history-list">
              {otherTournaments.map((s) => {
                const meta = historyNames[s.tournamentId];
                return (
                  <div
                    key={s.tournamentId}
                    className="history-item"
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/tournaments/${s.tournamentId}`)}
                  >
                    <span className="history-game-icon" aria-hidden="true">🏆</span>
                    <div className="min-w-0 flex-1">
                      <div className="history-game">{meta?.nameAr ?? `بطولة ${s.tournamentId.slice(0, 8)}`}</div>
                      <div className="history-date">
                        {meta?.gameNameAr ?? ''}
                        {meta && (
                          <span className={`badge ${TOURNAMENT_STATUS_BADGE[meta.status] ?? 'badge-cyan'} history-open-badge`}>
                            {TOURNAMENT_STATUS_LABELS[meta.status] ?? meta.status}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {s.champion && <span className="badge badge-gold">🏆</span>}
                      {!s.champion && s.eliminated && <span className="badge badge-red">مُقصى</span>}
                      {!s.champion && !s.eliminated && s.advanced && <span className="badge badge-green">متأهل</span>}
                      <span className="history-points">
                        {s.wins.toLocaleString('ar')} / {s.losses.toLocaleString('ar')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
