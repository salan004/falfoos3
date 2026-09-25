import { useEffect, useMemo, useState } from 'react';
import { PlayerAvatar } from './PlayerAvatar';
import { selectTournamentTeam } from '../utils/competitiveApi';
import type { CompetitionType, TeamDto } from '../types/competitive';

/**
 * Roadmap #2 — polished Arabic RTL team selection.
 *
 * The client NEVER decides eligibility, capacity or ownership: it renders the
 * server team projection and calls the team-selection endpoint, which derives
 * the player from the session. This component only mirrors the authoritative
 * state back to the user.
 */

interface TeamSelectionPanelProps {
  tournamentId: string;
  competitionType: CompetitionType;
  teams: TeamDto[];
  playerTeamId: string | null;
  canSelect: boolean;
  onChanged: () => void;
}

function mapSelectionError(code: string | null): string {
  switch (code) {
    case 'team_full':
      return 'هذا الفريق مكتمل العدد — اختر فريقًا آخر.';
    case 'teams_locked':
      return 'تم إغلاق اختيار الفرق لهذه البطولة.';
    case 'tournament_not_open':
      return 'انتهى وقت اختيار الفرق.';
    case 'tournament_cancelled':
      return 'تم إلغاء هذه البطولة.';
    case 'not_registered':
      return 'أنت غير مسجّل في هذه البطولة.';
    case 'account_not_linked':
      return 'يجب ربط حسابك بلاعب FalFoos أولًا.';
    case 'unauthenticated':
      return 'سجّل الدخول لاختيار فريقك.';
    case 'team_not_found':
      return 'هذا الفريق غير متاح.';
    case 'network_error':
      return 'تعذّر الاتصال بالخادم. أعد المحاولة.';
    default:
      return 'تعذّر اختيار الفريق. أعد المحاولة.';
  }
}

function TeamCard({
  team,
  selected,
  canSelect,
  busy,
  onSelect,
}: {
  team: TeamDto;
  selected: boolean;
  canSelect: boolean;
  busy: boolean;
  onSelect: (teamId: string) => void;
}) {
  const full = team.full && !selected;
  const disabled = !canSelect || full || busy;
  return (
    <article
      className={`team-select-card ${selected ? 'is-selected' : ''} ${full ? 'is-full' : ''}`}
    >
      <header className="team-select-card-head">
        <span className="team-select-card-icon" aria-hidden="true">⚔️</span>
        <h3 className="team-select-card-name">{team.nameAr}</h3>
        <span className="team-select-card-count badge badge-yellow">
          {team.memberCount.toLocaleString('ar')}
          {team.capacity ? ` / ${team.capacity.toLocaleString('ar')}` : ''}
        </span>
      </header>

      <div className="team-select-members">
        {team.members.length === 0 ? (
          <span className="team-select-empty">لا يوجد أعضاء بعد</span>
        ) : (
          team.members.map((m) => (
            <div key={m.playerId} className="team-select-member">
              <PlayerAvatar
                id={m.playerId}
                name={m.displayName ?? 'لاعب'}
                avatarUrl={m.avatarUrl ?? undefined}
                size={32}
              />
              <span className="team-select-member-name">{m.displayName ?? 'لاعب'}</span>
            </div>
          ))
        )}
      </div>

      <footer className="team-select-card-foot">
        {selected ? (
          <span className="team-select-badge is-current">✓ فريقك الحالي</span>
        ) : (
          <button
            type="button"
            className="btn-neon team-select-btn"
            disabled={disabled}
            onClick={() => onSelect(team.id)}
          >
            {full ? 'مكتمل العدد' : busy ? 'جارٍ الاختيار…' : 'انضم إلى هذا الفريق'}
          </button>
        )}
      </footer>
    </article>
  );
}

export function TeamSelectionPanel({
  tournamentId,
  competitionType,
  teams,
  playerTeamId,
  canSelect,
  onChanged,
}: TeamSelectionPanelProps) {
  const [busyTeamId, setBusyTeamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Clear only transient errors when the authoritative state changes; a success
  // notice stays visible until the next selection attempt.
  useEffect(() => {
    setError(null);
  }, [playerTeamId, canSelect]);

  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.teamNo - b.teamNo), [teams]);

  async function choose(teamId: string): Promise<void> {
    if (busyTeamId) return;
    setBusyTeamId(teamId);
    setError(null);
    setNotice(null);
    const res = await selectTournamentTeam(tournamentId, teamId);
    setBusyTeamId(null);
    if (!res.ok) {
      setError(mapSelectionError(res.error));
      return;
    }
    setNotice('تم اختيار فريقك بنجاح ⚔️');
    onChanged();
  }

  if (sortedTeams.length === 0) {
    return null;
  }

  const currentTeam = playerTeamId ? sortedTeams.find((t) => t.id === playerTeamId) : undefined;
  const duel = competitionType === 'team_vs_team';

  return (
    <section className="team-select-section" aria-label="اختيار الفريق">
      <div className="team-select-head">
        <h2 className="section-title">⚔️ اختر فريقك</h2>
        {!canSelect && (
          <span className="team-select-locked">
            {currentTeam ? `فريقك: ${currentTeam.nameAr}` : 'اختيار الفرق مغلق حاليًا'}
          </span>
        )}
      </div>

      {notice && <div className="team-select-notice is-ok">{notice}</div>}
      {error && <div className="team-select-notice is-error">{error}</div>}

      <div className={duel ? 'team-select-duel' : 'team-select-grid'}>
        {sortedTeams.map((team, index) => (
          <div key={team.id} className="team-select-cell">
            {duel && index === 1 && <span className="team-select-vs">VS</span>}
            <TeamCard
              team={team}
              selected={team.id === playerTeamId}
              canSelect={canSelect}
              busy={busyTeamId === team.id}
              onSelect={choose}
            />
          </div>
        ))}
      </div>

      <p className="team-select-hint">
        {canSelect
          ? 'يمكنك تغيير فريقك حتى إغلاق التسجيل وبدء البطولة.'
          : 'لا يمكن تغيير الفريق بعد إغلاق التسجيل.'}
      </p>
    </section>
  );
}
