import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHashRoute } from '../hooks/useHashRoute';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { useAuthSession } from '../hooks/useAuthSession';
import { onCompetitiveEvent } from '../utils/socket';
import { BracketView, type BracketPlayerMeta } from '../components/BracketView';
import { CompetitiveParticipantCard } from '../components/CompetitiveParticipantCard';
import { PlayerAvatar } from '../components/PlayerAvatar';
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
  generateBracket,
  recordMatchResult,
  correctMatchResult,
  setMatchStatus,
  openDispute,
  resolveDispute,
} from '../utils/competitiveApi';

interface TournamentDetailPageProps {
  tournamentId: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  open: 'التسجيل مفتوح',
  active: 'جارية',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-cyan',
  open: 'badge-green',
  active: 'badge-yellow',
  completed: 'badge-cyan',
  cancelled: 'badge-red',
};

const MATCH_STATUS_LABELS: Record<string, string> = {
  pending: 'بالانتظار',
  scheduled: 'مجدولة',
  active: 'جارية',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  disputed: 'نزاع',
};

const MATCH_STATUS_BADGE: Record<string, string> = {
  pending: 'badge-cyan',
  scheduled: 'badge-cyan',
  active: 'badge-yellow',
  completed: 'badge-green',
  cancelled: 'badge-red',
  disputed: 'badge-red',
};

const dateFormatter = new Intl.DateTimeFormat('ar', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function TournamentDetailPage({ tournamentId }: TournamentDetailPageProps) {
  const { navigate } = useHashRoute();
  const headerRef = useScrollReveal<HTMLDivElement>();
  const { user } = useAuthSession();
  const isAdmin = user?.role === 'admin';

  const [summary, setSummary] = useState<TournamentSummary | null>(null);
  const [roster, setRoster] = useState<CompetitiveRosterEntry[]>([]);
  const [bracket, setBracket] = useState<BracketDto | null>(null);
  const [matches, setMatches] = useState<MatchDto[]>([]);
  const [profiles, setProfiles] = useState<Map<string, GameLeaderboardEntry>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    setLoading(false);
  }, [tournamentId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Phase 4F — real-time invalidation. Server events are refetch signals only;
  // we never apply LP/Elo/rank locally. Debounced so a burst (e.g. a correction
  // emits several events) results in a single refetch.
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
      });
    }
    for (const [playerId, profile] of profiles) {
      const existing = map.get(playerId);
      map.set(playerId, {
        name: existing?.name ?? profile.displayName ?? 'لاعب',
        avatarUrl: existing?.avatarUrl ?? profile.avatarUrl,
        seed: existing?.seed ?? null,
        rankName: profile.rank.rankName,
        lp: profile.lp,
        elo: profile.elo,
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
        if (match.winnerPlayerId === null) continue; // corrected draw: neither W nor L
        if (match.winnerPlayerId === p.playerId) rec.wins += 1;
        else rec.losses += 1;
      }
    }
    return records;
  }, [matches]);

  const runAdminAction = useCallback(
    async (action: () => Promise<{ ok: boolean; error: string | null }>) => {
      setBusy(true);
      setAdminError(null);
      const result = await action();
      setBusy(false);
      if (!result.ok) {
        setAdminError(result.error || 'فشل تنفيذ العملية');
        return;
      }
      await load();
    },
    [load]
  );

  if (loading) {
    return (
      <main className="page">
        <div className="panel text-center py-12 loading-pulse text-[var(--text-dim)]">جارٍ تحميل البطولة…</div>
      </main>
    );
  }

  if (error || !summary) {
    return (
      <main className="page">
        <div className="panel text-center py-12 text-[var(--text-dim)]">{error || 'البطولة غير موجودة'}</div>
      </main>
    );
  }

  const championMeta = summary.championPlayerId ? playerMeta.get(summary.championPlayerId) : undefined;
  const canGenerate = isAdmin && !summary.bracketGenerated && summary.status === 'open';

  return (
    <main className="page tournament-detail-page">
      {/* ---------- Header ---------- */}
      <div ref={headerRef} className="reveal tournament-detail-header" style={{ textAlign: 'center', padding: '32px 0 20px' }}>
        {summary.imageUrl && (
          <div className="tournament-detail-image" style={{ marginBottom: '16px', maxWidth: 600, margin: '0 auto 16px' }}>
            <img
              src={summary.imageUrl}
              alt={summary.nameAr}
              loading="lazy"
              decoding="async"
              style={{ width: '100%', borderRadius: 'var(--radius)' }}
            />
          </div>
        )}
        <div className="brand-kicker">🏆 الفلفوسيين المصنفين</div>
        <h1 className="hero-title" style={{ fontSize: '2rem' }}>{summary.nameAr}</h1>
        <div className="flex items-center justify-center gap-3 flex-wrap mt-4">
          <span className={`badge ${STATUS_BADGE[summary.status] ?? 'badge-cyan'}`}>
            {STATUS_LABELS[summary.status] ?? summary.status}
          </span>
          <button
            className="badge badge-cyan"
            style={{ cursor: 'pointer', border: 'none' }}
            onClick={() => navigate(`/stream-games/${summary.gameId}`)}
            title="فتح مركز اللعبة"
          >
            🎮 {summary.gameNameAr}
          </button>
        </div>
        {summary.descriptionAr && <p className="hero-subtitle mt-4">{summary.descriptionAr}</p>}
      </div>

      {/* ---------- Champion ---------- */}
      {summary.championPlayerId && (
        <section className="panel tournament-champion-panel">
          <div className="tournament-champion-crown" aria-hidden="true">🏆</div>
          <div className="tournament-champion-label">البطل</div>
          <PlayerAvatar
            id={summary.championPlayerId}
            name={championMeta?.name ?? 'البطل'}
            avatarUrl={championMeta?.avatarUrl ?? undefined}
            size={72}
          />
          <h2 className="tournament-champion-name">{championMeta?.name ?? 'البطل'}</h2>
          {championMeta?.rankName && <span className="badge badge-cyan">{championMeta.rankName}</span>}
          {typeof championMeta?.lp === 'number' && (
            <div className="tournament-champion-stats">
              {championMeta.lp.toLocaleString('ar')} LP
              {typeof championMeta.elo === 'number' ? ` • ${championMeta.elo.toLocaleString('ar')} Elo` : ''}
            </div>
          )}
        </section>
      )}

      {/* ---------- Stats ---------- */}
      <div className="panel tournament-stats-panel">
        <div className="tournament-stats-row">
          <div className="tournament-stat">
            <div className="tournament-stat-value">
              {summary.participantCount.toLocaleString('ar')}
              {summary.maxParticipants ? ` / ${summary.maxParticipants.toLocaleString('ar')}` : ''}
            </div>
            <div className="tournament-stat-label">المشاركون</div>
          </div>
          <div className="tournament-stat">
            <div className="tournament-stat-value">{summary.totalRounds.toLocaleString('ar')}</div>
            <div className="tournament-stat-label">الأدوار</div>
          </div>
          <div className="tournament-stat">
            <div className="tournament-stat-value">
              {summary.completedMatchCount.toLocaleString('ar')} / {summary.matchCount.toLocaleString('ar')}
            </div>
            <div className="tournament-stat-label">المباريات المكتملة</div>
          </div>
          {summary.byes > 0 && (
            <div className="tournament-stat">
              <div className="tournament-stat-value">{summary.byes.toLocaleString('ar')}</div>
              <div className="tournament-stat-label">تأهل تلقائي</div>
            </div>
          )}
          {summary.startsAt && (
            <div className="tournament-stat">
              <div className="tournament-stat-value">{dateFormatter.format(new Date(summary.startsAt))}</div>
              <div className="tournament-stat-label">البداية</div>
            </div>
          )}
        </div>
      </div>

      {/* ---------- Admin bracket generation ---------- */}
      {canGenerate && (
        <div className="panel tournament-admin-bar">
          <span className="text-sm text-[var(--text-dim)]">التسجيل مفتوح — يمكنك توليد جدول البطولة الآن.</span>
          <button
            className="btn-neon"
            disabled={busy}
            onClick={() => runAdminAction(() => generateBracket(tournamentId))}
          >
            توليد جدول البطولة
          </button>
        </div>
      )}

      {isAdmin && adminError && <div className="panel text-[var(--neon-red)] mb-4">{adminError}</div>}

      {/* ---------- Participants ---------- */}
      <section className="mb-10">
        <h2 className="section-title" style={{ textAlign: 'center', marginBottom: '16px' }}>
          المشاركون ({roster.length.toLocaleString('ar')})
        </h2>
        {roster.length === 0 ? (
          <div className="panel text-center py-12 text-[var(--text-dim)]">
            لا يوجد مشاركون بعد — التسجيل يتم عبر بوت الفلفوس فقط
          </div>
        ) : (
          <div className="participants-grid">
            {roster.map((entry, index) => {
              const rec = participantRecords.get(entry.playerId) ?? { wins: 0, losses: 0 };
              return (
                <CompetitiveParticipantCard
                  key={entry.playerId}
                  entry={entry}
                  profile={profiles.get(entry.playerId)}
                  wins={rec.wins}
                  losses={rec.losses}
                  index={index}
                  onClick={() => navigate(`/profile/${entry.playerId}`)}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- Bracket ---------- */}
      <section className="mb-10">
        <h2 className="section-title" style={{ textAlign: 'center', marginBottom: '16px' }}>جدول البطولة</h2>
        {bracket ? (
          <BracketView bracket={bracket} players={playerMeta} championPlayerId={summary.championPlayerId} />
        ) : (
          <div className="panel text-center py-12 text-[var(--text-dim)]">لم يتم توليد جدول البطولة بعد</div>
        )}
      </section>

      {/* ---------- Matches ---------- */}
      <section className="mb-16">
        <h2 className="section-title" style={{ textAlign: 'center', marginBottom: '16px' }}>المباريات</h2>
        {matches.length === 0 ? (
          <div className="panel text-center py-12 text-[var(--text-dim)]">لا توجد مباريات بعد</div>
        ) : (
          <div className="tournament-matches-list">
            {matches.map((match) => (
              <MatchRow
                key={match.id}
                match={match}
                roundName={roundNames.get(match.roundNo) ?? `دور ${match.roundNo}`}
                playerMeta={playerMeta}
                isAdmin={isAdmin}
                busy={busy}
                onAction={runAdminAction}
                onReload={load}
                tournamentId={tournamentId}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function MatchRow({
  match,
  roundName,
  playerMeta,
  isAdmin,
  busy,
  onAction,
  onReload,
  tournamentId,
}: {
  match: MatchDto;
  roundName: string;
  playerMeta: Map<string, BracketPlayerMeta>;
  isAdmin: boolean;
  busy: boolean;
  onAction: (action: () => Promise<{ ok: boolean; error: string | null }>) => Promise<void>;
  onReload: () => Promise<void>;
  tournamentId: string;
}) {
  const [pickingWinner, setPickingWinner] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [correctWinner, setCorrectWinner] = useState<string | null>(null);
  const [correctChosen, setCorrectChosen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const terminal = match.status === 'completed' || match.status === 'cancelled';

  const playerName = (playerId: string | null) =>
    playerId ? playerMeta.get(playerId)?.name ?? 'لاعب' : '—';

  const canStart = isAdmin && (match.status === 'pending' || match.status === 'scheduled');
  const canRecord = isAdmin && (match.status === 'pending' || match.status === 'scheduled' || match.status === 'active');
  const canCancel = isAdmin && !terminal && match.status !== 'disputed';
  const canDispute = isAdmin && match.status === 'active';
  const canResolve = isAdmin && match.status === 'disputed';
  const canCorrect = isAdmin && match.status === 'completed';

  const submitCorrection = async () => {
    if (!correctChosen || reason.trim().length === 0 || !confirm) return;
    setSubmitting(true);
    setCorrectError(null);
    const res = await correctMatchResult(tournamentId, match.id, {
      correctedWinnerPlayerId: correctWinner,
      reason: reason.trim(),
    });
    setSubmitting(false);
    if (!res.ok) {
      setCorrectError(res.error === 'network_error' ? 'فشل الاتصال بالخادم' : res.error || 'فشل تصحيح النتيجة');
      return;
    }
    setCorrecting(false);
    setCorrectChosen(false);
    setCorrectWinner(null);
    setReason('');
    setConfirm(false);
    await onReload();
  };

  return (
    <article className="panel tournament-match">
      <div className="tournament-match-head">
        <span className="badge badge-cyan">{roundName}</span>
        <span className="text-xs text-[var(--text-dim)]">
          م{match.slotNo.toLocaleString('ar')}
          {match.bestOf ? ` • BO${match.bestOf.toLocaleString('ar')}` : ''}
        </span>
        <span className={`badge ${MATCH_STATUS_BADGE[match.status] ?? 'badge-cyan'}`}>
          {MATCH_STATUS_LABELS[match.status] ?? match.status}
        </span>
      </div>

      <div className="tournament-match-body">
        {match.players.map((p) => {
          const isWinner = match.winnerPlayerId === p.playerId;
          const meta = playerMeta.get(p.playerId);
          return (
            <div
              key={`${p.slot}-${p.playerId}`}
              className={`tournament-match-player ${isWinner ? 'is-winner' : ''} ${
                match.status === 'completed' && match.winnerPlayerId !== null && !isWinner ? 'is-defeated' : ''
              }`}
            >
              <PlayerAvatar id={p.playerId} name={meta?.name ?? 'لاعب'} avatarUrl={meta?.avatarUrl ?? undefined} size={30} />
              <span className="tournament-match-player-name">{meta?.name ?? 'لاعب'}</span>
              {meta?.rankName && <span className="badge badge-cyan">{meta.rankName}</span>}
              {isWinner && <span className="tournament-match-winner-tag">فائز</span>}
            </div>
          );
        })}
        {match.players.length < 2 && (
          <div className="tournament-match-player is-bye">
            <span className="tournament-match-player-name">بانتظار الفائز</span>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="tournament-match-admin">
          {correcting ? (
            <div className="tournament-match-correction">
              <div className="tournament-match-correction-title">
                تصحيح نتيجة مباراة مكتملة
                <span className="text-xs text-[var(--text-dim)]">
                  {' '}· الحالية: {match.winnerPlayerId ? playerName(match.winnerPlayerId) : 'تعادل'}
                </span>
              </div>
              <div className="text-xs text-[var(--text-dim)]">الفائز بعد التصحيح:</div>
              <div className="flex gap-2 flex-wrap">
                {match.players.map((p) => (
                  <button
                    key={`c-${p.playerId}`}
                    type="button"
                    className={correctChosen && correctWinner === p.playerId ? 'btn-solid-cyan text-sm' : 'btn-neon text-sm'}
                    onClick={() => {
                      setCorrectWinner(p.playerId);
                      setCorrectChosen(true);
                    }}
                  >
                    {playerName(p.playerId)}
                  </button>
                ))}
                <button
                  type="button"
                  className={correctChosen && correctWinner === null ? 'btn-solid-cyan text-sm' : 'btn-neon text-sm'}
                  onClick={() => {
                    setCorrectWinner(null);
                    setCorrectChosen(true);
                  }}
                >
                  تعادل
                </button>
              </div>
              <input
                className="w-full input-field text-sm"
                placeholder="سبب التصحيح (مطلوب)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <label className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
                <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                أؤكد أن هذا التصحيح مقصود وسيُعاد احتساب النقاط
              </label>
              {correctError && <div className="text-[var(--neon-red)] text-xs">{correctError}</div>}
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  className="btn-neon text-sm"
                  disabled={submitting || !confirm || !correctChosen || reason.trim().length === 0}
                  onClick={submitCorrection}
                >
                  {submitting ? 'جارٍ التصحيح…' : 'تأكيد التصحيح'}
                </button>
                <button
                  type="button"
                  className="text-xs text-[var(--text-dim)]"
                  onClick={() => {
                    setCorrecting(false);
                    setCorrectError(null);
                  }}
                >
                  إلغاء
                </button>
              </div>
            </div>
          ) : pickingWinner ? (
            <div className="tournament-match-winner-pick">
              <span className="text-xs text-[var(--text-dim)]">اختر الفائز:</span>
              {match.players.map((p) => (
                <button
                  key={p.playerId}
                  className="btn-neon text-sm"
                  disabled={busy}
                  onClick={async () => {
                    await onAction(() => recordMatchResult(tournamentId, match.id, { winnerPlayerId: p.playerId }));
                    setPickingWinner(false);
                  }}
                >
                  {playerName(p.playerId)}
                </button>
              ))}
              <button className="text-xs text-[var(--text-dim)]" onClick={() => setPickingWinner(false)}>
                إلغاء
              </button>
            </div>
          ) : (
            <>
              {canRecord && (
                <button className="btn-neon text-sm" disabled={busy} onClick={() => setPickingWinner(true)}>
                  تسجيل النتيجة
                </button>
              )}
              {canCorrect && (
                <button className="btn-neon text-sm" disabled={busy} onClick={() => setCorrecting(true)}>
                  تصحيح النتيجة
                </button>
              )}
              {canStart && (
                <button
                  className="btn-neon text-sm"
                  disabled={busy}
                  onClick={() => onAction(() => setMatchStatus(tournamentId, match.id, 'active'))}
                >
                  بدء المباراة
                </button>
              )}
              {canDispute && (
                <button
                  className="btn-neon text-sm"
                  disabled={busy}
                  onClick={() => onAction(() => openDispute(tournamentId, match.id))}
                >
                  فتح نزاع
                </button>
              )}
              {canResolve && (
                <button
                  className="btn-neon text-sm"
                  disabled={busy}
                  onClick={() => onAction(() => resolveDispute(tournamentId, match.id, 'completed'))}
                >
                  حل النزاع كمكتملة
                </button>
              )}
              {canCancel && (
                <button
                  className="btn-neon text-sm"
                  style={{ background: 'var(--neon-red)' }}
                  disabled={busy}
                  onClick={() => onAction(() => setMatchStatus(tournamentId, match.id, 'cancelled'))}
                >
                  إلغاء المباراة
                </button>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
