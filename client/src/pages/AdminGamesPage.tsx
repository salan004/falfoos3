import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import { useAuthSession } from '../hooks/useAuthSession';
import { AdminGate } from '../components/AdminGate';
import { GameDirectoryEntry } from '../types/game';

export function AdminGamesPage() {
  const { user, isLoading } = useAuthSession();
  const [games, setGames] = useState<GameDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingGame, setEditingGame] = useState<GameDirectoryEntry | null>(null);
  const [formData, setFormData] = useState<{
    id?: string;
    slug: string;
    name_ar: string;
    description_ar: string;
    image_url: string;
    is_active: number;
    sort_order: number;
  }>({
    slug: '',
    name_ar: '',
    description_ar: '',
    image_url: '',
    is_active: 1,
    sort_order: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadGames = async () => {
    try {
      const res = await apiFetch('/api/admin/games');
      const data = await res.json();
      if (res.ok) {
        setGames(data.games || []);
      }
    } catch {
      setError('فشل تحميل الألعاب');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      let res;
      if (editingGame) {
        res = await apiFetch(`/api/admin/games/${editingGame.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
      } else {
        res = await apiFetch('/api/admin/games', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'فشل العملية');
        return;
      }

      setShowForm(false);
      setEditingGame(null);
      resetForm();
      loadGames();
    } catch {
      setError('فشل الاتصال بالخادم');
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (game: GameDirectoryEntry) => {
    setEditingGame(game);
    setFormData({
      id: game.id,
      slug: game.slug,
      name_ar: game.name_ar,
      description_ar: game.description_ar || '',
      image_url: game.image_url || '',
      is_active: game.is_active,
      sort_order: game.sort_order,
    });
    setShowForm(true);
  };

  const startCreate = () => {
    setEditingGame(null);
    resetForm();
    setShowForm(true);
  };

  const resetForm = () => {
    setFormData({
      slug: '',
      name_ar: '',
      description_ar: '',
      image_url: '',
      is_active: 1,
      sort_order: 0,
    });
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('تأكيد إلغاء تفعيل اللعبة؟')) return;
    try {
      const res = await apiFetch(`/api/admin/games/${id}/deactivate`, { method: 'POST' });
      if (res.ok) loadGames();
    } catch {
      setError('فشل إلغاء التفعيل');
    }
  };

  if (isLoading || !user || user.role !== 'admin') {
    return null;
  }

  return (
    <main className="page" style={{ maxWidth: 1000 }}>
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">إدارة الألعاب</h1>
          <p className="hero-subtitle">إدارة الألعاب المتاحة للبطولات</p>
        </div>
        <AdminGate />
      </div>

      {error && <div className="panel text-[var(--neon-red)] mb-4">{error}</div>}

      {!showForm ? (
        <div>
          <button className="btn-neon mb-6" onClick={startCreate}>
            + إضافة لعبة جديدة
          </button>

          {loading ? (
            <div className="panel text-center py-8">جارٍ التحميل…</div>
          ) : (
            <div className="space-y-3">
              {games.map((g) => (
                <div key={g.id} className="panel flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {g.image_url && (
                      <img src={g.image_url} alt={g.name_ar} className="w-12 h-12 object-cover rounded" />
                    )}
                    <div>
                      <div className="font-bold">{g.name_ar}</div>
                      <div className="text-sm text-[var(--text-dim)]">
                        Slug: {g.slug} | {g.is_active ? 'مفعّل' : 'غير مفعّل'} | ترتيب: {g.sort_order}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button className="btn-neon text-sm" onClick={() => startEdit(g)}>
                      تعديل
                    </button>
                    {g.is_active && (
                      <button className="btn-neon text-sm" style={{ background: 'var(--neon-red)' }} onClick={() => handleDeactivate(g.id)}>
                        إلغاء تفعيل
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {games.length === 0 && (
                <div className="panel text-center py-8 text-[var(--text-dim)]">
                  لا توجد ألعاب — ابدأ بإضافة واحدة
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="panel" style={{ maxWidth: 600 }}>
          <h2 className="page-title mb-4">{editingGame ? 'تعديل اللعبة' : 'إضافة لعبة جديدة'}</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Slug (معرّف فريد، إنجليزي)</label>
              <input
                type="text"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                required
                disabled={!!editingGame}
                className="w-full input-field"
                placeholder="مثال: dueling_grounds"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">الاسم بالعربي</label>
              <input
                type="text"
                value={formData.name_ar}
                onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                required
                className="w-full input-field"
                placeholder="مثال: دويلينغ غراوندز"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">الوصف بالعربي</label>
              <textarea
                value={formData.description_ar}
                onChange={(e) => setFormData({ ...formData, description_ar: e.target.value })}
                className="w-full input-field"
                rows={3}
                placeholder="وصف موجز للعبة…"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">رابط الصورة (اختياري)</label>
              <input
                type="text"
                value={formData.image_url}
                onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                className="w-full input-field"
                placeholder="/assets/images/games/dueling_grounds.webp"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">الحالة</label>
                <select
                  value={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: parseInt(e.target.value) })}
                  className="w-full input-field"
                >
                  <option value={1}>مفعّل</option>
                  <option value={0}>غير مفعّل</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">ترتيب العرض</label>
                <input
                  type="number"
                  value={formData.sort_order}
                  onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) })}
                  className="w-full input-field"
                  min="0"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-4 border-t border-[var(--border-color)]">
              <button type="button" className="btn-neon" onClick={() => { setShowForm(false); setEditingGame(null); resetForm(); }}>
                إلغاء
              </button>
              <button type="submit" className="btn-neon" disabled={submitting}>
                {submitting ? 'جاري الحفظ…' : (editingGame ? 'حفظ التعديلات' : 'إضافة اللعبة')}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}