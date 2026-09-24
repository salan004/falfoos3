import { useCallback, useState } from 'react';
import { useRoute } from '../hooks/useRoute';
import { resolveImageUrl } from '../utils/api';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { useAuthSession } from '../hooks/useAuthSession';
import { useTournamentBracket } from '../hooks/useTournamentBracket';
import { useSeo } from '../seo/useSeo';
import { breadcrumbList, DEFAULT_DESCRIPTION } from '../seo/seo';
import { BracketView, type BracketPlayerMeta } from '../components/BracketView';
import { ArenaAtmosphere } from '../components/ArenaAtmosphere';
import { CompetitiveParticipantCard } from '../components/CompetitiveParticipantCard';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { RankBadge } from '../components/RankBadge';
import type { MatchDto } from '../types/competitive';
import {
  generateBracket,
  recordMatchResult,
  correctMatchResult,
  setMatchStatus,
  openDispute,
  resolveDispute,
  cancelTournament,
} from '../utils/competitiveApi';

interface TournamentDetailPageProps {
  tournamentId: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  open: 'مفتوحة',
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

export function TournamentDetailPage({ tournamentId }: TournamentDetailPageProps) {
  const { navigate } = useRoute();
  const headerRef = useScrollReveal<HTMLDivElement>();
  const { user } = useAuthSession();
  const isAdmin = user?.role === 'admin';

  // Post-Phase 8 — bracket/summary/roster/matches come from the shared hook so
  // the normal page and the Broadcast Bracket read the exact same data source.
  const {
    summary,
    roster,
    bracket,
    matches,
    profiles,
    playerMeta,
    roundNames,
    participantRecords,
    championMeta,
    loading,
    error,
    reload,
  } = useTournamentBracket(tournamentId);

  const [adminError, setAdminError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // F3 — a broken banner URL must never render a broken image.
  const [heroImageFailed, setHeroImageFailed] = useState(false);

  // SEO — route metadata from public tournament data only (never admin state).
  const tournamentPath = `/tournaments/${encodeURIComponent(tournamentId)}`;
  useSeo(
    summary
      ? {
          title: `${summary.nameAr} | FalFoos`,
          description:
            (summary.descriptionAr && summary.descriptionAr.trim()) ||
            `بطولة ${summary.nameAr} — ${summary.gameNameAr} على منصة فلفوس.`,
          path: tournamentPath,
          image: summary.imageUrl ? resolveImageUrl(summary.imageUrl) : undefined,
          type: 'article',
          jsonLd: [
            breadcrumbList([
              { name: 'FalFoos', path: '/' },
              { name: summary.gameNameAr, path: `/stream-games/${encodeURIComponent(summary.gameId)}` },
              { name: summary.nameAr, path: tournamentPath },
            ]),
          ],
        }
      : {
          title: 'بطولة | FalFoos',
          description: DEFAULT_DESCRIPTION,
          path: tournamentPath,
        }
  );

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
      await reload();
    },
    [reload]
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

  const canGenerate = isAdmin && !summary.bracketGenerated && summary.status === 'open';
  const canCancelTournament =
    isAdmin && (summary.status === 'draft' || summary.status === 'open' || summary.status === 'active');

  return (
    <main className="page tournament-detail-page">
      {/* Shared Games/Tournaments atmosphere — continuous with the hub and game
          pages. The internal structure below is unchanged. */}
      <ArenaAtmosphere />

      {/* ---------- Tournament Hero — banner image + centered title ---------- */}
      <header
        ref={headerRef}
        className={`tournament-hero reveal${
          summary.imageUrl && !heroImageFailed ? '' : ' is-fallback'
        }`}
      >
        {summary.imageUrl && !heroImageFailed && (
          <img
            className="tournament-hero-bg"
            src={resolveImageUrl(summary.imageUrl)}
            alt={summary.nameAr}
            loading="eager"
            decoding="async"
            onError={() => setHeroImageFailed(true)}
          />
        )}
        <div className="tournament-hero-content">
          <div className="brand-kicker">🏆 الفلفوسيين المصنفين</div>
          <h1 className="hero-title tournament-hero-title">{summary.nameAr}</h1>
          <div className="tournament-hero-meta">
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
          {summary.descriptionAr && (
            <p className="hero-subtitle tournament-hero-desc">{summary.descriptionAr}</p>
          )}
        </div>
      </header>

      {/* ---------- Championship Hero — shown only for a completed tournament ---------- */}
      {summary.status === 'completed' && summary.championPlayerId && (
        <section className="tournament-champion" aria-label="بطل البطولة">
          <div className="tournament-champion-frame" aria-hidden="true">
            <div className="tournament-champion-cup">
              <span className="tournament-champion-cup-bowl" />
              <span className="tournament-champion-cup-stem" />
              <span className="tournament-champion-cup-base" />
            </div>
          </div>
          <div className="tournament-champion-label">البطل</div>
          <div className="tournament-champion-avatar">
            <PlayerAvatar
              id={summary.championPlayerId}
              name={championMeta?.name ?? 'البطل'}
              avatarUrl={championMeta?.avatarUrl ?? undefined}
              size={120}
            />
          </div>
          <h2 className="tournament-champion-name">{championMeta?.name ?? 'البطل'}</h2>
          {championMeta?.rankName && (
            <div className="tournament-champion-rank">
              <RankBadge tierKey={championMeta?.tierKey} label={championMeta.rankName} size={22} />
              {championMeta.rankName}
            </div>
          )}
        </section>
      )}

      {/* ---------- Tournament HUD (participants · rounds · matches) ---------- */}
      <section className="tournament-hud" aria-label="إحصائيات البطولة">
        <div className="tournament-hud-cell">
          <span className="tournament-hud-icon" aria-hidden="true">👥</span>
          <span className="tournament-hud-value">
            {summary.participantCount.toLocaleString('ar')}
            {summary.maxParticipants ? (
              <span className="tournament-hud-value-sub"> / {summary.maxParticipants.toLocaleString('ar')}</span>
            ) : null}
          </span>
          <span className="tournament-hud-label">المشاركون</span>
        </div>
        <div className="tournament-hud-cell">
          <span className="tournament-hud-icon" aria-hidden="true">⟳</span>
          <span className="tournament-hud-value">{summary.totalRounds.toLocaleString('ar')}</span>
          <span className="tournament-hud-label">الأدوار</span>
        </div>
        <div className="tournament-hud-cell">
          <span className="tournament-hud-icon" aria-hidden="true">⚔</span>
          <span className="tournament-hud-value">
            {summary.completedMatchCount.toLocaleString('ar')}
            <span className="tournament-hud-value-sub"> / {summary.matchCount.toLocaleString('ar')}</span>
          </span>
          <span className="tournament-hud-label">المباريات</span>
        </div>
      </section>

      {/* ---------- Admin tournament actions — compact gaming tiles ---------- */}
      {isAdmin && (canGenerate || canCancelTournament) && (
        <section className="tournament-action-tiles" aria-label="إجراءات البطولة">
          {canGenerate && (
            <article className="tournament-action-tile">
              <span className="tournament-action-tile-icon" aria-hidden="true">⚔️</span>
              <div className="tournament-action-tile-copy">
                <h3 className="tournament-action-tile-title">توليد جدول البطولة</h3>
                <p className="tournament-action-tile-sub">إنشاء مواجهات البطولة</p>
              </div>
              <button
                className="btn-neon tournament-action-tile-btn"
                disabled={busy}
                onClick={() => runAdminAction(() => generateBracket(tournamentId))}
              >
                توليد الجدول
              </button>
            </article>
          )}
          {canCancelTournament && (
            <article className="tournament-action-tile is-destructive">
              <span className="tournament-action-tile-icon" aria-hidden="true">✕</span>
              <div className="tournament-action-tile-copy">
                <h3 className="tournament-action-tile-title">إلغاء البطولة</h3>
                <p className="tournament-action-tile-sub">إنهاء البطولة الحالية</p>
              </div>
              <button
                className="btn-neon tournament-action-tile-btn is-destructive"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('هل أنت متأكد من إلغاء هذه البطولة؟')) {
                    void runAdminAction(() => cancelTournament(tournamentId));
                  }
                }}
              >
                إلغاء البطولة
              </button>
            </article>
          )}
        </section>
      )}

      {isAdmin && adminError && <div className="panel text-[var(--neon-red)] mb-4">{adminError}</div>}

      {/* ---------- Participants ---------- */}
      <section className="mb-10">
        <div className="tournament-section-head">
          <h2 className="section-title">👥 المشاركون في البطولة</h2>
          {roster.length > 0 && (
            <span className="tournament-section-count">{roster.length.toLocaleString('ar')} مشاركين</span>
          )}
        </div>
        {roster.length === 0 ? (
          <div className="tournament-empty-state">
            <span className="tournament-empty-icon" aria-hidden="true">👥</span>
            <p className="tournament-empty-text">لا يوجد مشاركون بعد</p>
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
        <div className="tournament-section-head">
          <h2 className="section-title tournament-section-title">⚔ جدول البطولة</h2>
          {bracket && (
            <button
              type="button"
              className="btn-neon tournament-broadcast-btn"
              title="افتح نسخة البث الشفافة (مناسبة لـ OBS)"
              onClick={() => {
                const url = `${window.location.origin}/broadcast/${encodeURIComponent(tournamentId)}`;
                window.open(url, '_blank', 'noopener');
              }}
            >
              📺 براكيت البث
            </button>
          )}
        </div>
        {bracket ? (
          <BracketView bracket={bracket} players={playerMeta} championPlayerId={summary.championPlayerId} />
        ) : (
          <div className="tournament-empty-state">
            <span className="tournament-empty-icon" aria-hidden="true">⚔</span>
            <p className="tournament-empty-text">لم يتم إنشاء جدول البطولة حتى الآن</p>
          </div>
        )}
      </section>

      {/* ---------- Matches ---------- */}
      <section className="mb-16">
        <h2 className="section-title tournament-section-title">⚔ المباريات</h2>
        {matches.length === 0 ? (
          <div className="tournament-empty-state">
            <span className="tournament-empty-icon" aria-hidden="true">⚔</span>
            <p className="tournament-empty-text">لا توجد مباريات حتى الآن</p>
          </div>
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
                onReload={reload}
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
