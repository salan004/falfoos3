import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import { useAuthSession } from '../hooks/useAuthSession';
import { AdminGate } from '../components/AdminGate';
import { TournamentWithGame, TournamentStatus } from '../types/game';

export function AdminTournamentsPage() {
  const { user, isLoading } = useAuthSession();
  const [tournaments, setTournaments] = useState<TournamentWithGame[]>([]);
  const [games, setGames] = useState<{ id: string; name_ar: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTournament, setEditingTournament] = useState<TournamentWithGame | null>(null);
  const [viewingParticipants, setViewingParticipants] = useState<string | null>(null);
  const [participants, setParticipants] = useState<any[]>([]);
  const [formData, setFormData] = useState<any>({
    game_id: '',
    name_ar: '',
    description_ar: '',
    image_url: '',
    max_participants: '',
    starts_at: '',
    ends_at: '',
    status: 'draft',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    loadTournaments();
    loadGames();
  }, [isLoading]);

  const loadTournaments = async () => {
    try {
      const res = await apiFetch('/api/admin/tournaments');
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
        setGames(data.games.filter((g: any) => g.is_active).map((g: any) => ({ id: g.id, name_ar: g.name_ar })));
      }
    } catch {}
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const payload = {
        game_id: formData.game_id,
        name_ar: formData.name_ar,
        description_ar: formData.description_ar,
        image_url: formData.image_url || undefined,
        max_participants: formData.max_participants ? parseInt(formData.max_participants) : undefined,
        starts_at: formData.starts_at ? new Date(formData.starts_at).getTime() : undefined,
        ends_at: formData.ends_at ? new Date(formData.ends_at).getTime() : undefined,
        status: formData.status,
      };

      let res;
      if (editingTournament) {
        res = await apiFetch(`/api/admin/tournaments/${editingTournament.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await apiFetch('/api/admin/tournaments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'فشل العملية');
        return;
      }

      setShowForm(false);
      setEditingTournament(null);
      resetForm();
      loadTournaments();
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
      max_participants: tournament.max_participants || '',
      starts_at: tournament.starts_at ? new Date(tournament.starts_at).toISOString().slice(0, 16) : '',
      ends_at: tournament.ends_at ? new Date(tournament.ends_at).toISOString().slice(0, 16) : '',
      status: tournament.status,
    });
    setShowForm(true);
  };

  const startCreate = () => {
    setEditingTournament(null);
    resetForm();
    setShowForm(true);
  };

  const resetForm = () => {
    setFormData({
      game_id: '',
      name_ar: '',
      description_ar: '',
      image_url: '',
      max_participants: '',
      starts_at: '',
      ends_at: '',
      status: 'draft',
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('تأكيد حذف البطولة؟ (فقط البطولات في حالة مسودة)')) return;
    try {
      const res = await apiFetch(`/api/admin/tournaments/${id}`, { method: 'DELETE' });
      if (res.ok) loadTournaments();
    } catch {
      setError('فشل الحذف');
    }
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

  const handleAddParticipant = async (tournamentId: string, playerId: string, source: 'admin' | 'qualifier') => {
    try {
      const res = await apiFetch(`/api/admin/tournaments/${tournamentId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId, source, ticket_ref: undefined }),
      });
      if (res.ok) {
        handleViewParticipants(tournamentId);
      }
    } catch {
      setError('فشل إضافة المشارك');
    }
  };

  const statusLabels: Record<TournamentStatus, string> = {
    draft: 'مسودة',
    open: 'مفتوحة',
    active: 'نشطة',
    completed: 'مكتملة',
    cancelled: 'ملغاة',
  };

  const statusColors: Record<TournamentStatus, string> = {
    draft: 'badge-cyan',
    open: 'badge-green',
    active: 'badge-yellow',
    completed: 'badge-cyan',
    cancelled: 'badge-red',
  };

  if (isLoading || !user || user.role !== 'admin') {
    return null;
  }

  return (
    <main className="page" style={{ maxWidth: 1200 }}>
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">إدارة البطولات</h1>
          <p className="hero-subtitle">إنشاء وتعديل البطولات وعرض المشاركين</p>
        </div>
        <AdminGate />
      </div>

      {error && <div className="panel text-[var(--neon-red)] mb-4">{error}</div>}

      {!showForm && !viewingParticipants ? (
        <div>
          <button className="btn-neon mb-6" onClick={startCreate}>
            + إنشاء بطولة جديدة
          </button>

          {loading ? (
            <div className="panel text-center py-8">جارٍ التحميل…</div>
          ) : (
            <div className="space-y-3">
              {tournaments.map((t) => (
                <div key={t.id} className="panel flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div>
                      <div className="font-bold">{t.name_ar}</div>
                      <div className="text-sm text-[var(--text-dim)]">
                        {t.game_name_ar} | {statusLabels[t.status] || t.status} | مشاركين: {t.participant_count}{t.max_participants ? ` / ${t.max_participants}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button className="btn-neon text-sm" onClick={() => handleViewParticipants(t.id)}>
                      {viewingParticipants === t.id ? 'إخفاء المشاركين' : 'المشاركين'}
                    </button>
                    <button className="btn-neon text-sm" onClick={() => startEdit(t)}>
                      تعديل
                    </button>
                    {t.status === 'draft' && (
                      <button className="btn-neon text-sm" style={{ background: 'var(--neon-red)' }} onClick={() => handleDelete(t.id)}>
                        حذف
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {tournaments.length === 0 && (
                <div className="panel text-center py-8 text-[var(--text-dim)]">
                  لا توجد بطولات — ابدأ بإنشاء واحدة
                </div>
              )}
            </div>
          )}
        </div>
      ) : viewingParticipants ? (
        <div className="panel" style={{ maxWidth: 800 }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="page-title">المشاركون</h2>
            <button className="btn-neon" onClick={() => setViewingParticipants(null)}>
              ← رجوع
            </button>
          </div>

          {participants.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-dim)]">
              لا يوجد مشاركين بعد
            </div>
          ) : (
            <div className="space-y-2">
              {participants.map((p, i) => (
                <div key={p.player_id} className="flex items-center justify-between p-3 panel">
                  <div className="flex items-center gap-3">
                    {p.youtube_avatar_url ? (
                      <img src={p.youtube_avatar_url} alt={p.youtube_name || ''} className="w-10 h-10 rounded-full" />
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
                        {' · '}{p.status}
                      </div>
                    </div>
                  </div>
                  {p.status !== 'cancelled' && (
                    <button className="btn-neon text-sm" style={{ background: 'var(--neon-red)' }} onClick={() => {}}>
                      إلغاء
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="panel" style={{ maxWidth: 700 }}>
          <h2 className="page-title mb-4">{editingTournament ? 'تعديل البطولة' : 'إنشاء بطولة جديدة'}</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">اللعبة *</label>
              <select
                value={formData.game_id}
                onChange={(e) => setFormData({ ...formData, game_id: e.target.value })}
                required
                className="w-full input-field"
              >
                <option value="">اختر اللعبة</option>
                {games.map((g) => <option key={g.id} value={g.id}>{g.name_ar}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">اسم البطولة *</label>
              <input
                type="text"
                value={formData.name_ar}
                onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                required
                className="w-full input-field"
                placeholder="مثال: بطولة Dueling Grounds #1"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">الوصف</label>
              <textarea
                value={formData.description_ar}
                onChange={(e) => setFormData({ ...formData, description_ar: e.target.value })}
                className="w-full input-field"
                rows={3}
                placeholder="وصف البطولة…"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">رابط الصورة (اختياري)</label>
              <input
                type="text"
                value={formData.image_url}
                onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                className="w-full input-field"
                placeholder="/assets/images/tournaments/dueling_grounds_1.webp"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">الحد الأقصى للمشاركين</label>
                <input
                  type="number"
                  value={formData.max_participants}
                  onChange={(e) => setFormData({ ...formData, max_participants: e.target.value })}
                  className="w-full input-field"
                  min="1"
                  placeholder="اترك فارغاً للا حد"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">الحالة</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full input-field"
                >
                  <option value="draft">مسودة</option>
                  <option value="open">مفتوحة للتسجيل</option>
                  <option value="active">نشطة</option>
                  <option value="completed">مكتملة</option>
                  <option value="cancelled">ملغاة</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">تاريخ البداية</label>
                <input
                  type="datetime-local"
                  value={formData.starts_at}
                  onChange={(e) => setFormData({ ...formData, starts_at: e.target.value })}
                  className="w-full input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">تاريخ النهاية (اختياري)</label>
                <input
                  type="datetime-local"
                  value={formData.ends_at}
                  onChange={(e) => setFormData({ ...formData, ends_at: e.target.value })}
                  className="w-full input-field"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-color)]">
              <button type="button" className="btn-neon" onClick={() => { setShowForm(false); setEditingTournament(null); resetForm(); }}>
                إلغاء
              </button>
              <button type="submit" className="btn-neon" disabled={submitting}>
                {submitting ? 'جاري الحفظ…' : (editingTournament ? 'حفظ التعديلات' : 'إنشاء البطولة')}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}