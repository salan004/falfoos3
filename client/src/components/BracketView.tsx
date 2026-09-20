import { PlayerAvatar } from './PlayerAvatar';
import { RankBadge } from './RankBadge';
import type { BracketDto, MatchDto } from '../types/competitive';

export interface BracketPlayerMeta {
  name: string;
  avatarUrl?: string | null;
  rankName?: string | null;
  tierKey?: string | null;
  lp?: number | null;
  elo?: number | null;
  seed?: number | null;
}

interface BracketViewProps {
  bracket: BracketDto;
  players: Map<string, BracketPlayerMeta>;
  championPlayerId?: string | null;
  /** `broadcast` renders the same tree with stream-overlay-friendly styling. */
  variant?: 'default' | 'broadcast';
  selectedMatchId?: string | null;
  onSelectMatch?: (match: MatchDto) => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'بالانتظار',
  scheduled: 'مجدولة',
  active: 'جارية',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  disputed: 'نزاع',
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'badge-cyan',
  scheduled: 'badge-cyan',
  active: 'badge-yellow',
  completed: 'badge-green',
  cancelled: 'badge-red',
  disputed: 'badge-red',
};

function MatchCard({
  match,
  players,
  hasNext,
  isFinalRound,
  interactive,
  selected,
  onSelect,
}: {
  match: MatchDto;
  players: Map<string, BracketPlayerMeta>;
  hasNext: boolean;
  isFinalRound: boolean;
  interactive: boolean;
  selected: boolean;
  onSelect?: (match: MatchDto) => void;
}) {
  const statusLabel = STATUS_LABELS[match.status] ?? match.status;
  const badge = STATUS_BADGE[match.status] ?? 'badge-cyan';

  return (
    <div
      className={`bracket-match ${hasNext ? 'has-next' : ''} ${
        match.status === 'completed' ? 'is-completed' : ''
      } ${match.status === 'active' ? 'is-active' : ''} ${isFinalRound ? 'is-final-round' : ''} ${
        interactive ? 'is-interactive' : ''
      } ${selected ? 'is-selected' : ''}`}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      onClick={interactive ? () => onSelect?.(match) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.(match);
              }
            }
          : undefined
      }
    >
      <div className="bracket-match-head">
        <span className="bracket-match-slot">م{match.slotNo.toLocaleString('ar')}</span>
        {match.bestOf ? <span className="bracket-match-bestof">BO{match.bestOf.toLocaleString('ar')}</span> : null}
        <span className={`badge ${badge} bracket-match-status`}>{statusLabel}</span>
      </div>
      <div className="bracket-players">
        {match.players.length === 0 ? (
          <div className="bracket-player bracket-player-empty">
            <span className="bracket-player-name">بانتظار الفائزين</span>
          </div>
        ) : (
          match.players.map((p) => {
            const meta = players.get(p.playerId);
            const isWinner = match.winnerPlayerId === p.playerId;
            return (
              <div
                key={`${p.slot}-${p.playerId}`}
                className={`bracket-player ${isWinner ? 'is-winner' : ''} ${
                  match.status === 'completed' && match.winnerPlayerId !== null && !isWinner ? 'is-defeated' : ''
                }`}
              >
                <PlayerAvatar id={p.playerId} name={meta?.name ?? 'لاعب'} avatarUrl={meta?.avatarUrl ?? undefined} size={24} />
                <div className="bracket-player-body">
                  <span className="bracket-player-name">{meta?.name ?? 'لاعب'}</span>
                  <span className="bracket-player-meta">
                    <RankBadge tierKey={meta?.tierKey} label={meta?.rankName} size={14} />
                    {meta?.rankName ? <span className="bracket-player-rank">{meta.rankName}</span> : null}
                    {typeof meta?.lp === 'number' ? <span>{meta.lp.toLocaleString('ar')} LP</span> : null}
                    {typeof meta?.elo === 'number' ? <span>Elo {meta.elo.toLocaleString('ar')}</span> : null}
                  </span>
                </div>
                {typeof p.seed === 'number' ? <span className="bracket-player-seed">#{p.seed.toLocaleString('ar')}</span> : null}
              </div>
            );
          })
        )}
        {match.players.length === 1 && (
          <div className="bracket-player bracket-player-bye">
            <span className="bracket-player-name">تأهل تلقائي</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Phase 4E / Post-Phase 8 — visual single-elimination bracket rendered purely
 * from the Phase 4D bracket DTO. Round 1 is the outer column (right in RTL),
 * later rounds move inward, and the final sits next to the champion.
 *
 * Geometry: every match column is a fixed track and every gap column has a
 * fixed width, so the connector lines land exactly on each match's vertical
 * centre. A single uniform row unit (`--bracket-row`) keeps every round's
 * matches on a predictable grid; a match always centres inside the rows it
 * spans, so its centre is mathematically the midpoint of its two feeders.
 *
 * The `broadcast` variant reuses the exact same tree and geometry with
 * overlay-tuned styling. The frontend never calculates progression.
 */
export function BracketView({
  bracket,
  players,
  championPlayerId,
  variant = 'default',
  selectedMatchId,
  onSelectMatch,
}: BracketViewProps) {
  if (!bracket || bracket.rounds.length === 0) {
    return (
      <div className={`panel text-center py-12 text-[var(--text-dim)]${variant === 'broadcast' ? ' bracket-empty-broadcast' : ''}`}>
        لم يتم توليد جدول البطولة بعد
      </div>
    );
  }

  const rounds = bracket.rounds;
  const totalRounds = rounds.length;
  const firstRoundCount = rounds[0].matches.length;
  const championMeta = championPlayerId ? players.get(championPlayerId) : undefined;
  const interactive = typeof onSelectMatch === 'function';

  const columns: string[] = [];
  for (let ri = 0; ri < totalRounds; ri++) {
    columns.push('minmax(var(--bracket-col, 210px), 1fr)');
    if (ri < totalRounds - 1) columns.push('var(--bracket-gap, 46px)');
  }
  if (championPlayerId) {
    columns.push('var(--bracket-gap, 46px)');
    columns.push('minmax(180px, 0.9fr)');
  }

  const nodes: React.ReactNode[] = [];

  // Round headers share the match grid (row 1) so they can never drift out of
  // alignment with their column. Match/connector rows all start at row 2.
  rounds.forEach((round, ri) => {
    nodes.push(
      <div
        key={`h-${round.roundNo}`}
        className={`bracket-round-head ${ri === totalRounds - 1 ? 'is-final' : ''}`}
        style={{ gridColumn: 2 * ri + 1, gridRow: 1 }}
      >
        {round.nameAr}
      </div>
    );
  });
  rounds.forEach((round, ri) => {
    const span = Math.pow(2, ri);
    const hasNext = ri < totalRounds - 1;
    round.matches.forEach((match, mi) => {
      nodes.push(
        <div
          key={`m-${match.id}`}
          className="bracket-slot"
          style={{
            gridColumn: 2 * ri + 1,
            gridRow: `${mi * span + 2} / span ${span}`,
          }}
        >
          <MatchCard
            match={match}
            players={players}
            hasNext={hasNext}
            isFinalRound={ri === totalRounds - 1}
            interactive={interactive}
            selected={selectedMatchId === match.id}
            onSelect={onSelectMatch}
          />
        </div>
      );
    });

    if (hasNext) {
      const nextCount = rounds[ri + 1].matches.length;
      for (let ci = 0; ci < nextCount; ci++) {
        nodes.push(
          <div
            key={`c-${ri}-${ci}`}
            className="bracket-conn"
            aria-hidden="true"
            style={{
              gridColumn: 2 * ri + 2,
              gridRow: `${ci * 2 * span + 2} / span ${2 * span}`,
            }}
          />
        );
      }
    }
  });

  if (championPlayerId) {
    nodes.push(
      <div
        key="c-final"
        className="bracket-conn bracket-conn-final"
        aria-hidden="true"
        style={{ gridColumn: 2 * totalRounds, gridRow: `2 / span ${firstRoundCount}` }}
      />
    );
    nodes.push(
      <div
        key="champion"
        className="bracket-champion"
        style={{ gridColumn: 2 * totalRounds + 1, gridRow: `2 / span ${firstRoundCount}` }}
      >
        <div className="bracket-champion-crown" aria-hidden="true">🏆</div>
        <div className="bracket-champion-label">البطل</div>
        <PlayerAvatar
          id={championPlayerId}
          name={championMeta?.name ?? 'البطل'}
          avatarUrl={championMeta?.avatarUrl ?? undefined}
          size={48}
        />
        <div className="bracket-champion-name">{championMeta?.name ?? 'البطل'}</div>
        {championMeta?.rankName ? (
          <div className="bracket-champion-rank">
            <RankBadge tierKey={championMeta?.tierKey} label={championMeta?.rankName} size={18} />
            {championMeta.rankName}
          </div>
        ) : null}
        {typeof championMeta?.lp === 'number' ? (
          <div className="bracket-champion-stats">
            {championMeta.lp.toLocaleString('ar')} LP
            {typeof championMeta.elo === 'number' ? ` • ${championMeta.elo.toLocaleString('ar')} Elo` : ''}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`bracket-scroll bracket-scroll-${variant}`} dir="rtl">
      <div
        className={`bracket-grid bracket-grid-${variant}`}
        style={{
          gridTemplateColumns: columns.join(' '),
          gridTemplateRows: `auto repeat(${firstRoundCount}, var(--bracket-row, 132px))`,
        }}
      >
        {nodes}
      </div>
    </div>
  );
}
