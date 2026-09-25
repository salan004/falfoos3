import { useEffect, useMemo, useState } from 'react';
import { apiFetch, resolveImageUrl } from '../utils/api';
import { useAuthSession } from '../hooks/useAuthSession';
import { useRoute } from '../hooks/useRoute';
import { AdminGate } from '../components/AdminGate';
import { AdminAccessDenied } from '../components/admin/AdminAccessDenied';
import { ImageUploadField } from '../components/admin/ImageUploadField';
import { hideTournament, restoreTournament } from '../utils/competitiveApi';
import { TournamentWithGame, TournamentStatus, CompetitionType, TeamFormation } from '../types/game';

/** R5 — admin visibility filter for the tournament list. */
type VisibilityFilter = 'visible' | 'hidden' | 'all';

interface TournamentFormData {
  game_id: string;
  name_ar: string;
  description_ar: string;
  image_url: string;
  max_participants: string;
  /** Optional Loyalty ticket price; empty = legacy/default bot pricing. */
  ticket_cost: string;
  /** Initial status only — lifecycle changes happen from the list actions. */
  status: 'draft' | 'open';
  /** Roadmap #2 — competition configuration. */
  competition_type: CompetitionType;
  team_formation: TeamFormation | '';
  team1_name: string;
  team2_name: string;
}

const EMPTY_FORM: TournamentFormData = {
  game_id: '',
  name_ar: '',
  description_ar: '',
  image_url: '',
  max_participants: '',
  ticket_cost: '',
  status: 'draft',
  competition_type: 'individual',
  team_formation: '',
  team1_name: '',
  team2_name: '',
};

/** Roadmap #2 — Arabic labels for the competition configuration controls. */
const COMPETITION_OPTIONS: { value: CompetitionType; label: string }[] = [
  { value: 'individual', label: 'فردي' },
  { value: 'team_vs_team', label: 'فريق ضد فريق' },
  { value: 'two_vs_two', label: '2 ضد 2' },
];

const FORMATION_OPTIONS: { value: TeamFormation; label: string }[] = [
  { value: 'random', label: 'توزيع عشوائي' },
  { value: 'player_choice', label: 'اختيار اللاعبين' },
];

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'مسودة',
  open: 'مفتوحة',
  active: 'نشطة',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

const STATUS_COLORS: Record<TournamentStatus, string> = {
  draft: 'badge-cyan',
  open: 'badge-green',
  active: 'badge-yellow',
  completed: 'badge-cyan',
  cancelled: 'badge-red',
};

/**
 * Actions mirror the backend lifecycle (`TournamentService.validateStatusTransition`).
 * Only valid transitions from the current status are offered.
 */
interface StatusAction {
  to: TournamentStatus;
  label: string;
  destructive?: boolean;
}

const STATUS_ACTIONS: Record<TournamentStatus, StatusAction[]> = {
  draft: [
    { to: 'open', label: 'فتح التسجيل' },
    { to: 'cancelled', label: 'إلغاء البطولة', destructive: true },
  ],
  open: [
    { to: 'active', label: 'بدء البطولة' },
    { to: 'cancelled', label: 'إلغاء البطولة', destructive: true },
  ],
  active: [
    { to: 'completed', label: 'إكمال البطولة' },
    { to: 'cancelled', label: 'إلغاء البطولة', destructive: true },
  ],
  completed: [],
  cancelled: [],
};

interface AdminTournamentsPageProps {
  gameId?: string;
}

export function AdminTournamentsPage({ gameId }: AdminTournamentsPageProps) {
  const { user, isLoading } = useAuthSession();
  const { navigate } = useRoute();
  const [tournaments, setTournaments] = useState<TournamentWithGame[]>([]);
  const [games, setGames] = useState<{ id: string; name_ar: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTournament, setEditingTournament] = useState<TournamentWithGame | null>(null);
  const [viewingParticipants, setViewingParticipants] = useState<string | null>(null);
  const [participants, setParticipants] = useState<any[]>([]);
  const [formData, setFormData] = useState<TournamentFormData>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('visible');

  const loadTournaments = async () => {
    try {
      const res = await apiFetch(`/api/admin/tournaments?visibility=${visibilityFilter}`);
      const data = await res.json();
      if (res.ok) {
        setTournaments(data.tournaments || []);
      }
    } catch {
      setError('فشل تحميل البطولات');
    } finally {
      setLoading(false);
    }
  };

  const loadGames = async () => {
    try {
      const res = await apiFetch('/api/admin/games');
      const data = await res.json();
      if (res.ok) {
        setGames(
          data.games
            .filter((g: any) => g.is_active)
            .map((g: any) => ({ id: g.id, name_ar: g.name_ar }))
        );
      }
    } catch {
      /* the game select is non-critical for the list view */
    }
  };

  useEffect(() => {
    if (isLoading) return;
    void loadTournaments();
    void loadGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, visibilityFilter]);

  const visibleTournaments = useMemo(
    () => (gameId ? tournaments.filter((t) => t.game_id === gameId) : tournaments),
    [tournaments, gameId]
  );

  const filteredGameName = useMemo(
    () => (gameId ? games.find((g) => g.id === gameId)?.name_ar ?? null : null),
    [gameId, games]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const isTeam = formData.competition_type !== 'individual';
      const base = {
        game_id: formData.game_id,
        name_ar: formData.name_ar.trim(),
        description_ar: formData.description_ar.trim(),
        // Empty string clears the image on edit; on create it renders as the
        // placeholder (the public card falls back to the game image).
        image_url: formData.image_url,
        max_participants: formData.max_participants
          ? parseInt(formData.max_participants, 10)
          : undefined,
        // Empty clears the configured price (NULL = legacy/default bot pricing).
        ticket_cost: formData.ticket_cost.trim() === ''
          ? null
          : parseInt(formData.ticket_cost, 10),
        // Roadmap #2 — competition configuration.
        competition_type: formData.competition_type,
        team_formation: isTeam ? (formData.team_formation || 'random') : null,
        team1_name:
          formData.competition_type === 'team_vs_team' ? formData.team1_name.trim() : null,
        team2_name:
          formData.competition_type === 'team_vs_team' ? formData.team2_name.trim() : null,
      };

      // dates (starts_at / ends_at) are deliberately not sent — UI removal only.
      const res = editingTournament
        ? await apiFetch(`/api/admin/tournaments/${editingTournament.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(base),
          })
        : await apiFetch('/api/admin/tournaments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...base, status: formData.status }),
          });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'فشل العملية');
        return;
      }

      closeForm();
      void loadTournaments();
    } catch {
      setError('فشل الاتصال بالخادم');
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (tournament: TournamentWithGame) => {
    setEditingTournament(tournament);
    setFormData({
      game_id: tournament.game_id,
      name_ar: tournament.name_ar,
      description_ar: tournament.description_ar || '',
      image_url: tournament.image_url || '',
      max_participants: tournament.max_participants ? String(tournament.max_participants) : '',
      ticket_cost: tournament.ticket_cost ? String(tournament.ticket_cost) : '',
      status: 'draft',
      competition_type: tournament.competition_type ?? 'individual',
      team_formation: tournament.team_formation ?? '',
      team1_name: tournament.team1_name ?? '',
      team2_name: tournament.team2_name ?? '',
    });
    setShowForm(true);
    setError(null);
  };

  const startCreate = () => {
    setEditingTournament(null);
    setFormData({ ...EMPTY_FORM, game_id: gameId ?? '' });
    setShowForm(true);
    setError(null);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingTournament(null);
    setFormData(EMPTY_FORM);
  };

  const changeStatus = async (tournament: TournamentWithGame, action: StatusAction) => {
    if (action.destructive && !confirm(`تأكيد ${action.label}؟`)) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/tournaments/${tournament.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: action.to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'فشل تغيير الحالة');
        return;
      }
      void loadTournaments();
    } catch {
      setError('فشل الاتصال بالخادم');
    }
  };

  /**
   * R5 — hide a tournament from normal listings. Non-destructive and
   * reversible: no data, rows, or images are deleted and the lifecycle status
   * is never changed.
   */
  const handleHide = async (tournament: TournamentWithGame) => {
    if (
      !confirm(
        `إخفاء البطولة «${tournament.name_ar}» من الموقع؟\nلن تُحذف أي بيانات ويمكن استعادتها لاحقًا.`
      )
    ) {
      return;
    }
    setError(null);
    const res = await hideTournament(tournament.id);
    if (!res.ok) {
      setError(res.error || 'فشل إخفاء البطولة');
      return;
    }
    void loadTournaments();
  };

  /** R5 — restore a hidden tournament's visibility (status untouched). */
  const handleRestore = async (tournament: TournamentWithGame) => {
    setError(null);
    const res = await restoreTournament(tournament.id);
    if (!res.ok) {
      setError(res.error || 'فشل استعادة البطولة');
      return;
    }
    void loadTournaments();
  };

  const handleViewParticipants = async (tournamentId: string) => {
    if (viewingParticipants === tournamentId) {
      setViewingParticipants(null);
      return;
    }
    try {
      const res = await apiFetch(`/api/admin/tournaments/${tournamentId}/participants`);
      const data = await res.json();
      if (res.ok) {
        setParticipants(data.participants || []);
        setViewingParticipants(tournamentId);
      }
    } catch {
      setError('فشل تحميل المشاركين');
    }
  };

  if (isLoading) {
    return (
      <main className="page admin-page">
        <div className="panel text-center py-12 loading-pulse text-[var(--text-dim)]">
          جارٍ التحقق من الصلاحية…
        </div>
      </main>
    );
  }

  if (!user || user.role !== 'admin') {
    return <AdminAccessDenied />;
  }

  return (
    <main className="page admin-page">
      <div className="admin-page-head">
        <div>
          <span className="admin-page-kicker">🏆 إدارة البطولات</span>
          <h1 className="page-title">البطولات</h1>
          <p className="hero-subtitle">
            {filteredGameName ? `بطولات: ${filteredGameName}` : 'إنشاء وتعديل البطولات وعرض المشاركين'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-neon text-sm" onClick={() => navigate('/dashboard')}>
            ← مركز التحكم
          </button>
          <AdminGate />
        </div>
      </div>

      {error && <div className="panel text-[var(--neon-red)] mb-4">{error}</div>}

      {!showForm && !viewingParticipants ? (
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-6">
            <button className="btn-neon" onClick={startCreate}>
              + إنشاء بطولة جديدة
            </button>
            <span className="text-sm text-[var(--text-dim)]" style={{ marginInlineStart: 'auto' }}>
              العرض:
            </span>
            {(['visible', 'hidden', 'all'] as VisibilityFilter[]).map((value) => (
              <button
                key={value}
                className={visibilityFilter === value ? 'btn-solid-cyan text-sm' : 'btn-neon text-sm'}
                onClick={() => setVisibilityFilter(value)}
              >
                {value === 'visible' ? 'الظاهرة' : value === 'hidden' ? 'المخفية' : 'الكل'}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="panel text-center py-8">جارٍ التحميل…</div>
          ) : (
            <div className="admin-list">
              {visibleTournaments.map((t) => (
                <div key={t.id} className="panel admin-list-row">
                  <div className="admin-list-row-main">
                    <div className="admin-list-thumb">
                      {t.image_url || t.game_image_url ? (
                        <img
                          src={resolveImageUrl(t.image_url || t.game_image_url)}
                          alt={t.name_ar}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span aria-hidden="true">🏆</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="admin-list-title">{t.name_ar}</div>
                      <div className="admin-list-meta">
                        <span className={`badge ${STATUS_COLORS[t.status]}`}>
                          {STATUS_LABELS[t.status]}
                        </span>
                        {t.hidden_at !== null && <span className="badge badge-red">مخفية</span>}
                        <span className="admin-list-meta-item">{t.game_name_ar}</span>
                        <span className="admin-list-meta-item">
                          مشاركون: {t.participant_count}
                          {t.max_participants ? ` / ${t.max_participants}` : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="admin-list-row-actions">
                    <button className="btn-neon text-sm" onClick={() => handleViewParticipants(t.id)}>
                      {viewingParticipants === t.id ? 'إخفاء المشاركين' : 'المشاركون'}
                    </button>
                    <button className="btn-neon text-sm" onClick={() => startEdit(t)}>
                      تعديل
                    </button>
                    {STATUS_ACTIONS[t.status].map((action) => (
                      <button
                        key={action.to}
                        className={`btn-neon text-sm${action.destructive ? ' admin-btn-danger' : ''}`}
                        onClick={() => changeStatus(t, action)}
                      >
                        {action.label}
                      </button>
                    ))}
                    {t.hidden_at !== null ? (
                      <button className="btn-neon text-sm" onClick={() => handleRestore(t)}>
                        استعادة
                      </button>
                    ) : (
                      <button
                        className="btn-neon text-sm admin-btn-danger"
                        onClick={() => handleHide(t)}
                      >
                        إخفاء
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {visibleTournaments.length === 0 && (
                <div className="panel text-center py-8 text-[var(--text-dim)]">
                  {visibilityFilter === 'hidden'
                    ? 'لا توجد بطولات مخفية.'
                    : visibilityFilter === 'all'
                      ? 'لا توجد بطولات.'
                      : 'لا توجد بطولات — ابدأ بإنشاء واحدة.'}
                </div>
              )}
            </div>
          )}
        </div>
      ) : viewingParticipants ? (
        <div className="panel admin-form-card">
          <div className="admin-form-head">
            <h2 className="page-title">المشاركون</h2>
            <button className="btn-neon" onClick={() => setViewingParticipants(null)}>
              ← رجوع
            </button>
          </div>

          {participants.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-dim)]">لا يوجد مشاركون بعد</div>
          ) : (
            <div className="space-y-2">
              {participants.map((p) => (
                <div key={p.player_id} className="flex items-center justify-between p-3 panel">
                  <div className="flex items-center gap-3">
                    {p.youtube_avatar_url ? (
                      <img
                        src={p.youtube_avatar_url}
                        alt={p.youtube_name || ''}
                        className="w-10 h-10 rounded-full"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-[var(--neon-cyan)] flex items-center justify-center text-[var(--dark)] font-bold">
                        {p.youtube_name?.charAt(0) || '؟'}
                      </div>
                    )}
                    <div>
                      <div className="font-medium">{p.youtube_name || 'قناة يوتيوب'}</div>
                      <div className="text-sm text-[var(--text-dim)]">
                        {p.source === 'purchase' && '🎫 تذكرة'}
                        {p.source === 'admin' && '👑 إدارة'}
                        {p.source === 'qualifier' && '⭐ تأهيل'}
                        {' · '}
                        {p.status}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="panel admin-form-card">
          <h2 className="page-title mb-4">
            {editingTournament ? 'تعديل البطولة' : 'إنشاء بطولة جديدة'}
          </h2>

          <form onSubmit={handleSubmit} className="admin-form">
            <section className="admin-form-section">
              <h3 className="admin-form-section-title">بيانات البطولة</h3>

              <div className="admin-field">
                <label className="admin-field-label" htmlFor="tournament-game">اللعبة *</label>
                <select
                  id="tournament-game"
                  value={formData.game_id}
                  onChange={(e) => setFormData({ ...formData, game_id: e.target.value })}
                  required
                  disabled={!!editingTournament}
                  className="w-full input-field"
                >
                  <option value="">اختر اللعبة</option>
                  {games.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name_ar}
                    </option>
                  ))}
                </select>
              </div>

              <div className="admin-field">
                <label className="admin-field-label" htmlFor="tournament-name">اسم البطولة *</label>
                <input
                  id="tournament-name"
                  type="text"
                  value={formData.name_ar}
                  onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                  required
                  maxLength={150}
                  className="w-full input-field"
                  placeholder="اكتب اسم البطولة"
                />
              </div>

              <div className="admin-field">
                <label className="admin-field-label" htmlFor="tournament-description">الوصف</label>
                <textarea
                  id="tournament-description"
                  value={formData.description_ar}
                  onChange={(e) => setFormData({ ...formData, description_ar: e.target.value })}
                  className="w-full input-field"
                  rows={3}
                  placeholder="وصف البطولة"
                />
              </div>
            </section>

            <section className="admin-form-section">
              <h3 className="admin-form-section-title">نوع المنافسة</h3>
              <div className="admin-form-grid">
                <div className="admin-field">
                  <label className="admin-field-label" htmlFor="tournament-competition">
                    نوع المنافسة *
                  </label>
                  <select
                    id="tournament-competition"
                    value={formData.competition_type}
                    onChange={(e) =>
                      setFormData({ ...formData, competition_type: e.target.value as CompetitionType })
                    }
                    className="w-full input-field"
                  >
                    {COMPETITION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {formData.competition_type !== 'individual' && (
                  <div className="admin-field">
                    <label className="admin-field-label" htmlFor="tournament-formation">
                      طريقة تشكيل الفرق *
                    </label>
                    <select
                      id="tournament-formation"
                      value={formData.team_formation || 'random'}
                      onChange={(e) =>
                        setFormData({ ...formData, team_formation: e.target.value as TeamFormation })
                      }
                      className="w-full input-field"
                    >
                      {FORMATION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {formData.competition_type === 'team_vs_team' && (
                <div className="admin-form-grid">
                  <div className="admin-field">
                    <label className="admin-field-label" htmlFor="tournament-team1">
                      اسم الفريق الأول
                    </label>
                    <input
                      id="tournament-team1"
                      type="text"
                      value={formData.team1_name}
                      onChange={(e) => setFormData({ ...formData, team1_name: e.target.value })}
                      maxLength={60}
                      className="w-full input-field"
                      placeholder="الفريق الأول"
                    />
                  </div>
                  <div className="admin-field">
                    <label className="admin-field-label" htmlFor="tournament-team2">
                      اسم الفريق الثاني
                    </label>
                    <input
                      id="tournament-team2"
                      type="text"
                      value={formData.team2_name}
                      onChange={(e) => setFormData({ ...formData, team2_name: e.target.value })}
                      maxLength={60}
                      className="w-full input-field"
                      placeholder="الفريق الثاني"
                    />
                  </div>
                </div>
              )}

              {formData.competition_type === 'two_vs_two' && (
                <p className="admin-field-hint">
                  أسماء الفرق في منافسة 2 ضد 2 تُنشأ تلقائيًا (الفريق 1، الفريق 2، …).
                  {formData.team_formation === 'player_choice'
                    ? ' يجب تحديد «عدد المشاركين» (زوجي) ليتحدد عدد الفرق.'
                    : ''}
                </p>
              )}

              {formData.competition_type !== 'individual' && (
                <p className="admin-field-hint">
                  {formData.team_formation === 'player_choice'
                    ? 'يختار اللاعبون فرقهم من صفحة البطولة بعد شراء التذكرة، ويُقفل الاختيار عند توليد الجدول.'
                    : 'يُوزّع اللاعبون على الفرق تلقائيًا عند توليد جدول البطولة.'}
                </p>
              )}
            </section>

            <section className="admin-form-section">
              <h3 className="admin-form-section-title">الصورة</h3>
              <ImageUploadField
                label="صورة البطولة"
                category="tournaments"
                value={formData.image_url}
                onChange={(url) => setFormData((prev) => ({ ...prev, image_url: url }))}
                disabled={submitting}
              />
            </section>

            <section className="admin-form-section">
              <h3 className="admin-form-section-title">الإعدادات</h3>
              <div className="admin-form-grid">
                <div className="admin-field">
                  <label className="admin-field-label" htmlFor="tournament-max">عدد المشاركين</label>
                  <input
                    id="tournament-max"
                    type="number"
                    value={formData.max_participants}
                    onChange={(e) => setFormData({ ...formData, max_participants: e.target.value })}
                    className="w-full input-field"
                    min="1"
                    placeholder="اتركه فارغًا للا حد"
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-field-label" htmlFor="tournament-ticket-cost">تكلفة التذكرة (نقاط)</label>
                  <input
                    id="tournament-ticket-cost"
                    type="number"
                    value={formData.ticket_cost}
                    onChange={(e) => setFormData({ ...formData, ticket_cost: e.target.value })}
                    className="w-full input-field"
                    min="1"
                    step="1"
                    placeholder="اتركه فارغًا لسعر البوت الافتراضي"
                  />
                </div>
                {!editingTournament && (
                  <div className="admin-field">
                    <label className="admin-field-label" htmlFor="tournament-status">حالة الإنشاء</label>
                    <select
                      id="tournament-status"
                      value={formData.status}
                      onChange={(e) =>
                        setFormData({ ...formData, status: e.target.value as 'draft' | 'open' })
                      }
                      className="w-full input-field"
                    >
                      <option value="draft">مسودة</option>
                      <option value="open">مفتوحة للتسجيل</option>
                    </select>
                    <p className="admin-field-hint">تُدار بقية الحالات من أزرار دورة الحياة في القائمة.</p>
                  </div>
                )}
              </div>
            </section>

            <div className="admin-form-actions">
              <button type="button" className="btn-neon" onClick={closeForm}>
                إلغاء
              </button>
              <button type="submit" className="btn-neon" disabled={submitting}>
                {submitting ? 'جاري الحفظ…' : editingTournament ? 'حفظ التعديلات' : 'إنشاء البطولة'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
