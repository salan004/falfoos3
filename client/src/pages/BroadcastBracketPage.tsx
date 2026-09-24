import { useEffect, useState } from 'react';
import { useTournamentBracket } from '../hooks/useTournamentBracket';
import { useSeo } from '../seo/useSeo';
import { BracketView, type BracketPlayerMeta } from '../components/BracketView';
import { PlayerAvatar } from '../components/PlayerAvatar';
import type { MatchDto } from '../types/competitive';

interface BroadcastBracketPageProps {
  tournamentId: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'بالانتظار',
  scheduled: 'مجدولة',
  active: 'جارية',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  disputed: 'نزاع',
};

function MatchDetail({
  match,
  roundName,
  players,
  onClose,
}: {
  match: MatchDto;
  roundName: string;
  players: Map<string, BracketPlayerMeta>;
  onClose: () => void;
}) {
  return (
    <aside className="broadcast-detail" aria-label="تفاصيل المباراة">
      <header className="broadcast-detail-head">
        <span className="broadcast-detail-round">{roundName}</span>
        <span className="broadcast-detail-slot">
          م{match.slotNo.toLocaleString('ar')}
          {match.bestOf ? ` • BO${match.bestOf.toLocaleString('ar')}` : ''}
        </span>
        <span className="broadcast-detail-status">{STATUS_LABELS[match.status] ?? match.status}</span>
        <button type="button" className="broadcast-detail-close" onClick={onClose} aria-label="إغلاق">
          ✕
        </button>
      </header>
      <div className="broadcast-detail-players">
        {match.players.length === 0 ? (
          <div className="broadcast-detail-empty">بانتظار الفائزين</div>
        ) : (
          match.players.map((p) => {
            const meta = players.get(p.playerId);
            const isWinner = match.winnerPlayerId === p.playerId;
            return (
              <div key={`${p.slot}-${p.playerId}`} className={`broadcast-detail-player ${isWinner ? 'is-winner' : ''}`}>
                <PlayerAvatar id={p.playerId} name={meta?.name ?? 'لاعب'} avatarUrl={meta?.avatarUrl ?? undefined} size={40} />
                <div className="broadcast-detail-player-body">
                  <span className="broadcast-detail-player-name">{meta?.name ?? 'لاعب'}</span>
                  <span className="broadcast-detail-player-meta">
                    {meta?.rankName ? <span>{meta.rankName}</span> : null}
                    {typeof meta?.lp === 'number' ? <span>{meta.lp.toLocaleString('ar')} LP</span> : null}
                    {typeof meta?.elo === 'number' ? <span>Elo {meta.elo.toLocaleString('ar')}</span> : null}
                  </span>
                </div>
                {isWinner ? <span className="broadcast-detail-winner">فائز</span> : null}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

/**
 * Post-Phase 8 — transparent, interactive Broadcast Bracket for stream overlays
 * (`#/broadcast/:tournamentId`).
 *
 * A different PRESENTATION of the SAME bracket: it consumes the shared
 * `useTournamentBracket` hook (the exact data source the normal Tournament
 * Detail page uses), so matches, results, progression and state are identical.
 * No separate data copy, no new tournament API.
 *
 * The page adds `broadcast-mode` to <body> so the page background becomes fully
 * transparent for OBS/browser-source compositing, and polls the same reload
 * function as a safety net when a Socket.IO connection is unavailable.
 */
export function BroadcastBracketPage({ tournamentId }: BroadcastBracketPageProps) {
  const { summary, bracket, playerMeta, roundNames, championPlayerId, loading, error, reload } =
    useTournamentBracket(tournamentId);
  const [selected, setSelected] = useState<MatchDto | null>(null);

  // SEO — stream overlay is presentation-only and must never be indexed.
  useSeo({
    title: summary ? `بث ${summary.nameAr} | FalFoos` : 'براكيت البث | FalFoos',
    description: 'نسخة بث شفافة من جدول بطولة فلفوس (للمشاهدة فقط).',
    path: `/broadcast/${encodeURIComponent(tournamentId)}`,
    robots: 'noindex,nofollow',
  });

  // Transparent overlay mode for the lifetime of this route.
  useEffect(() => {
    document.body.classList.add('broadcast-mode');
    return () => document.body.classList.remove('broadcast-mode');
  }, []);

  // Overlay safety net: refresh the SAME data on an interval (browser sources
  // may not carry the cookies the realtime socket needs).
  useEffect(() => {
    const id = window.setInterval(() => void reload(), 15000);
    return () => window.clearInterval(id);
  }, [reload]);

  if (loading) {
    return (
      <div className="broadcast-root broadcast-status" dir="rtl">
        جارٍ تحميل الباركيت…
      </div>
    );
  }

  if (error || !bracket) {
    return (
      <div className="broadcast-root broadcast-status" dir="rtl">
        {error || 'لم يتم توليد جدول البطولة بعد'}
      </div>
    );
  }

  const selectedRoundName = selected ? roundNames.get(selected.roundNo) ?? `دور ${selected.roundNo}` : '';

  return (
    <div className="broadcast-root" dir="rtl">
      <header className="broadcast-head">
        {summary?.gameNameAr ? <span className="broadcast-game">{summary.gameNameAr}</span> : null}
        <span className="broadcast-title">{summary?.nameAr ?? 'جدول البطولة'}</span>
        <span className="broadcast-live" aria-hidden="true">
          مباشر
        </span>
      </header>

      <BracketView
        bracket={bracket}
        players={playerMeta}
        championPlayerId={championPlayerId}
        variant="broadcast"
        selectedMatchId={selected?.id ?? null}
        onSelectMatch={(m) => setSelected((cur) => (cur?.id === m.id ? null : m))}
      />

      {selected ? (
        <MatchDetail
          match={selected}
          roundName={selectedRoundName}
          players={playerMeta}
          onClose={() => setSelected(null)}
        />
      ) : (
        <p className="broadcast-hint">اضغط على أي مباراة لعرض تفاصيلها</p>
      )}
    </div>
  );
}
