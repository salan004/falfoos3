import { PlayerAvatar } from './PlayerAvatar';
import { RankBadge } from './RankBadge';
import type { BracketDto, MatchDto, TeamDto } from '../types/competitive';

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
  /** Roadmap #2 — team lookup for team competitors + team champion. */
  teams?: Map<string, TeamDto>;
  championTeamId?: string | null;
  /** `broadcast` renders the same tree with stream-overlay-friendly styling. */
  variant?: 'default' | 'broadcast';
  selectedMatchId?: string | null;
  onSelectMatch?: (match: MatchDto) => void;
}

/** Compact team side: stacked member avatars + team name + member names. */
function TeamSide({
  team,
  fallbackName,
}: {
  team: TeamDto | undefined;
  fallbackName: string;
}) {
  const members = team?.members ?? [];
  const name = team?.nameAr ?? fallbackName;
  return (
    <>
      <div className="bracket-team-avatars" aria-hidden={members.length === 0}>
        {members.slice(0, 3).map((m) => (
          <PlayerAvatar
            key={m.playerId}
            id={m.playerId}
            name={m.displayName ?? 'لاعب'}
            avatarUrl={m.avatarUrl ?? undefined}
            size={26}
          />
        ))}
      </div>
      <div className="bracket-player-body">
        <span className="bracket-player-name" title={name}>
          ⚔️ {name}
        </span>
        <span className="bracket-player-sub bracket-team-members">
          {members
            .map((m) => m.displayName)
            .filter((n): n is string => !!n)
            .join(' · ')}
        </span>
      </div>
    </>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'بالانتظار',
  scheduled: 'مجدولة',
  active: 'جارية',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  disputed: 'نزاع',
};

interface MatchRange {
  /** Zero-based first row (leaf slot) this match occupies. */
  start: number;
  /** Number of first-round leaf slots this match covers. */
  span: number;
}

/**
 * Phase F2 — one competitor-focused match unit.
 *
 * The competitor NAME is the primary visual element. Match chrome (slot number,
 * BO, status) is compact; LP/Elo are intentionally not shown here (the bracket
 * is not a player card). Winner state and an advancement chevron point toward
 * the next round (leftward in RTL).
 */
function MatchCard({
  match,
  players,
  teams,
  hasNext,
  isFinalRound,
  interactive,
  selected,
  onSelect,
}: {
  match: MatchDto;
  players: Map<string, BracketPlayerMeta>;
  teams?: Map<string, TeamDto>;
  hasNext: boolean;
  isFinalRound: boolean;
  interactive: boolean;
  selected: boolean;
  onSelect?: (match: MatchDto) => void;
}) {
  const statusLabel = STATUS_LABELS[match.status] ?? match.status;
  const isCompleted = match.status === 'completed';
  const showBestOf = typeof match.bestOf === 'number' && match.bestOf > 1;

  return (
    <div
      className={`bracket-match ${hasNext ? 'has-next' : ''} ${
        isCompleted ? 'is-completed' : ''
      } ${match.status === 'active' ? 'is-active' : ''} ${isFinalRound ? 'is-final-round' : ''} ${
        interactive ? 'is-interactive' : ''
      } ${selected ? 'is-selected' : ''}`}
      data-status={match.status}
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
      <div className="bracket-match-topline">
        <span className="bracket-match-slot">م{match.slotNo.toLocaleString('ar')}</span>
        {showBestOf ? (
          <span className="bracket-match-bestof">BO{match.bestOf!.toLocaleString('ar')}</span>
        ) : null}
        <span className="bracket-match-status">{statusLabel}</span>
      </div>

      <div className="bracket-players">
        {match.players.length === 0 ? (
          <div className="bracket-player bracket-player-empty">
            <span className="bracket-player-name">بانتظار الفائزين</span>
          </div>
        ) : (
          <>
            {match.players.map((p) => {
              const isTeam = p.teamId !== null;
              const meta = p.playerId ? players.get(p.playerId) : undefined;
              const team = isTeam ? teams?.get(p.teamId!) : undefined;
              const name = isTeam ? (team?.nameAr ?? 'فريق') : (meta?.name ?? 'لاعب');
              const isWinner = isTeam
                ? match.winnerTeamId !== null && match.winnerTeamId === p.teamId
                : match.winnerPlayerId === p.playerId;
              const hasWinner = match.winnerPlayerId !== null || match.winnerTeamId !== null;
              const isDefeated = isCompleted && hasWinner && !isWinner;
              return (
                <div
                  key={`${p.slot}-${p.teamId ?? p.playerId}`}
                  className={`bracket-player ${isWinner ? 'is-winner' : ''} ${
                    isDefeated ? 'is-defeated' : ''
                  } ${isTeam ? 'is-team' : ''}`}
                >
                  {isTeam ? (
                    <TeamSide team={team} fallbackName={name} />
                  ) : (
                    <>
                      <PlayerAvatar
                        id={p.playerId!}
                        name={name}
                        avatarUrl={meta?.avatarUrl ?? undefined}
                        size={28}
                      />
                      <div className="bracket-player-body">
                        <span className="bracket-player-name" title={name}>
                          {name}
                        </span>
                        <span className="bracket-player-sub">
                          {typeof p.seed === 'number' ? (
                            <span className="bracket-player-seed">#{p.seed.toLocaleString('ar')}</span>
                          ) : null}
                          {meta?.rankName ? (
                            <span className="bracket-player-rank">
                              <RankBadge tierKey={meta?.tierKey} label={meta.rankName} size={13} />
                              {meta.rankName}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </>
                  )}
                  {isWinner ? <span className="bracket-player-advance" aria-hidden="true" /> : null}
                </div>
              );
            })}
            {match.players.length === 1 ? (
              <div className="bracket-player bracket-player-waiting">
                <span className="bracket-player-name">بانتظار الفائز</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Phase 4E / Post-Phase 8 / Phase F2 — Tournament Arena single-elimination tree.
 *
 * Rendered purely from the Phase 4D bracket DTO. Round 1 is the outer column
 * (right in RTL), later rounds move inward, the final sits next to the champion.
 *
 * Geometry: the tree is laid out on a leaf-slot grid of `bracketSize / 2` rows.
 * Each match's row range is derived from the server-provided advancement graph
 * (`nextMatchId` / `nextMatchSlot`) walking back from the final, so brackets
 * WITH BYES render correctly (a bye leaves an empty leaf slot instead of
 * shifting every later match). Connectors are drawn per next-round match and
 * adapt to one or two feeders. The frontend never computes progression, LP, Elo
 * or winners — the server remains authoritative.
 *
 * The `broadcast` variant reuses the exact same tree and geometry with
 * overlay-tuned styling.
 */
export function BracketView({
  bracket,
  players,
  championPlayerId,
  teams,
  championTeamId,
  variant = 'default',
  selectedMatchId,
  onSelectMatch,
}: BracketViewProps) {
  if (!bracket || bracket.rounds.length === 0) {
    return (
      <div
        className={`panel text-center py-12 text-[var(--text-dim)]${
          variant === 'broadcast' ? ' bracket-empty-broadcast' : ''
        }`}
      >
        لم يتم توليد جدول البطولة بعد
      </div>
    );
  }

  const rounds = bracket.rounds;
  const totalRounds = rounds.length;
  const leafCount = Math.max(1, Math.floor(bracket.bracketSize / 2));
  const championMeta = championPlayerId ? players.get(championPlayerId) : undefined;
  const championTeam = championTeamId ? teams?.get(championTeamId) : undefined;
  const hasChampion = !!(championPlayerId || championTeamId);
  const interactive = typeof onSelectMatch === 'function';

  // ---- Advancement graph (server-provided ids only) -----------------------
  const feedersByNext = new Map<string, { matchId: string; slot: number }[]>();
  for (const round of rounds) {
    for (const match of round.matches) {
      if (!match.nextMatchId) continue;
      const list = feedersByNext.get(match.nextMatchId) ?? [];
      list.push({ matchId: match.id, slot: match.nextMatchSlot ?? 1 });
      feedersByNext.set(match.nextMatchId, list);
    }
  }

  // Assign each match its leaf-slot range by walking back from the final.
  const ranges = new Map<string, MatchRange>();
  const finalMatch = rounds[totalRounds - 1]?.matches[0];
  if (finalMatch) {
    const assign = (matchId: string, start: number, span: number) => {
      if (ranges.has(matchId)) return;
      ranges.set(matchId, { start, span });
      const half = span / 2;
      for (const feeder of feedersByNext.get(matchId) ?? []) {
        assign(feeder.matchId, feeder.slot === 2 ? start + half : start, half);
      }
    };
    assign(finalMatch.id, 0, leafCount);
  }
  // Defensive fallback for any unreachable match (never expected).
  rounds.forEach((round, ri) => {
    const span = Math.pow(2, ri);
    round.matches.forEach((match, mi) => {
      if (!ranges.has(match.id)) ranges.set(match.id, { start: mi * span, span });
    });
  });

  const columns: string[] = [];
  for (let ri = 0; ri < totalRounds; ri++) {
    columns.push('minmax(var(--bracket-col, 240px), 1fr)');
    if (ri < totalRounds - 1) columns.push('var(--bracket-gap, 64px)');
  }
  if (hasChampion) {
    columns.push('var(--bracket-gap, 64px)');
    columns.push('minmax(200px, 0.9fr)');
  }

  const nodes: React.ReactNode[] = [];

  // Round rails sit BEHIND the matches and never affect connector geometry.
  rounds.forEach((round, ri) => {
    nodes.push(
      <div
        key={`rail-${round.roundNo}`}
        className={`bracket-rail ${ri === totalRounds - 1 ? 'is-final' : ''}`}
        aria-hidden="true"
        style={{ gridColumn: 2 * ri + 1, gridRow: `1 / span ${leafCount + 1}` }}
      />
    );
  });

  // Round headers share the match grid (row 1) so they cannot drift.
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

  // Matches — placed by their graph-derived leaf range.
  rounds.forEach((round, ri) => {
    const hasNext = ri < totalRounds - 1;
    round.matches.forEach((match) => {
      const range = ranges.get(match.id)!;
      nodes.push(
        <div
          key={`m-${match.id}`}
          className="bracket-slot"
          style={{
            gridColumn: 2 * ri + 1,
            gridRow: `${range.start + 2} / span ${range.span}`,
          }}
        >
          <MatchCard
            match={match}
            players={players}
            teams={teams}
            hasNext={hasNext && !!match.nextMatchId}
            isFinalRound={ri === totalRounds - 1}
            interactive={interactive}
            selected={selectedMatchId === match.id}
            onSelect={onSelectMatch}
          />
        </div>
      );
    });
  });

  // Connectors — one per next-round match, spanning that match's leaf range.
  for (let ri = 0; ri < totalRounds - 1; ri++) {
    for (const nextMatch of rounds[ri + 1].matches) {
      const feeders = feedersByNext.get(nextMatch.id) ?? [];
      if (feeders.length === 0) continue;
      const range = ranges.get(nextMatch.id)!;
      let singleClass = '';
      if (feeders.length === 1) {
        const feederRange = ranges.get(feeders[0].matchId)!;
        const isTop = feederRange.start < range.start + range.span / 2;
        singleClass = ` is-single ${isTop ? 'is-top' : 'is-bottom'}`;
      }
      nodes.push(
        <div
          key={`c-${nextMatch.id}`}
          className={`bracket-conn${singleClass}`}
          aria-hidden="true"
          style={{
            gridColumn: 2 * ri + 2,
            gridRow: `${range.start + 2} / span ${range.span}`,
          }}
        />
      );
    }
  }

  if (hasChampion && finalMatch) {
    const finalRange = ranges.get(finalMatch.id)!;
    nodes.push(
      <div
        key="c-final"
        className="bracket-conn bracket-conn-final"
        aria-hidden="true"
        style={{
          gridColumn: 2 * totalRounds,
          gridRow: `${finalRange.start + 2} / span ${finalRange.span}`,
        }}
      />
    );
    nodes.push(
      <div
        key="champion"
        className="bracket-champion"
        style={{
          gridColumn: 2 * totalRounds + 1,
          gridRow: `${finalRange.start + 2} / span ${finalRange.span}`,
        }}
      >
        <div className="bracket-champion-crown" aria-hidden="true">🏆</div>
        <div className="bracket-champion-label">البطل</div>
        {championTeam ? (
          <>
            <div className="bracket-team-avatars bracket-team-avatars-champion">
              {championTeam.members.map((m) => (
                <PlayerAvatar
                  key={m.playerId}
                  id={m.playerId}
                  name={m.displayName ?? 'لاعب'}
                  avatarUrl={m.avatarUrl ?? undefined}
                  size={40}
                />
              ))}
            </div>
            <div className="bracket-champion-name">⚔️ {championTeam.nameAr}</div>
            <div className="bracket-champion-rank">
              {championTeam.members.map((m) => m.displayName).filter(Boolean).join(' · ')}
            </div>
          </>
        ) : (
          <>
            <PlayerAvatar
              id={championPlayerId!}
              name={championMeta?.name ?? 'البطل'}
              avatarUrl={championMeta?.avatarUrl ?? undefined}
              size={48}
            />
            <div className="bracket-champion-name">{championMeta?.name ?? 'البطل'}</div>
            {championMeta?.rankName ? (
              <div className="bracket-champion-rank">
                <RankBadge tierKey={championMeta?.tierKey} label={championMeta.rankName} size={18} />
                {championMeta.rankName}
              </div>
            ) : null}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`bracket-frame bracket-frame-${variant}`}>
      {variant !== 'broadcast' ? (
        <p className="bracket-scroll-hint" aria-hidden="true">
          <span className="bracket-scroll-hint-arrows">↔</span>
          اسحب لاستعراض جميع الجولات
        </p>
      ) : null}
      <div className={`bracket-scroll bracket-scroll-${variant}`} dir="rtl">
        <div
          className={`bracket-grid bracket-grid-${variant}`}
          style={{
            gridTemplateColumns: columns.join(' '),
            gridTemplateRows: `auto repeat(${leafCount}, var(--bracket-row, 150px))`,
          }}
        >
          {nodes}
        </div>
      </div>
    </div>
  );
}
