import { useEffect, useState } from 'react';
import { apiFetch, resolveImageUrl } from '../utils/api';
import { useAuthSession } from '../hooks/useAuthSession';
import { useHashRoute } from '../hooks/useHashRoute';
import { AdminGate } from '../components/AdminGate';
import { AdminAccessDenied } from '../components/admin/AdminAccessDenied';
import { ImageUploadField } from '../components/admin/ImageUploadField';
import { GameDirectoryEntry } from '../types/game';

interface GameFormData {
  name_ar: string;
  description_ar: string;
  image_url: string;
  is_active: number;
  sort_order: number;
}

const EMPTY_FORM: GameFormData = {
  name_ar: '',
  description_ar: '',
  image_url: '',
  is_active: 1,
  sort_order: 0,
};

export function AdminGamesPage() {
  const { user, isLoading } = useAuthSession();
  const { navigate } = useHashRoute();
  const [games, setGames] = useState<GameDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingGame, setEditingGame] = useState<GameDirectoryEntry | null>(null);
  const [formData, setFormData] = useState<GameFormData>(EMPTY_FORM);
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

  useEffect(() => {
    if (isLoading) return;
    void loadGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // `slug` is intentionally not sent: the server generates it from the name.
      const payload = {
        name_ar: formData.name_ar.trim(),
        description_ar: formData.description_ar.trim(),
        // Empty string clears the image on edit; on create it is stored as
        // empty and renders as the placeholder.
        image_url: formData.image_url,
        is_active: formData.is_active,
        sort_order: formData.sort_order,
      };

      const res = editingGame
        ? await apiFetch(`/api/admin/games/${editingGame.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await apiFetch('/api/admin/games', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'فشل العملية');
        return;
      }

      closeForm();
      void loadGames();
    } catch {
      setError('فشل الاتصال بالخادم');
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (game: GameDirectoryEntry) => {
    setEditingGame(game);
    setFormData({
      name_ar: game.name_ar,
      description_ar: game.description_ar || '',
      image_url: game.image_url || '',
      is_active: game.is_active,
      sort_order: game.sort_order,
    });
    setShowForm(true);
    setError(null);
  };

  const startCreate = () => {
    setEditingGame(null);
    setFormData(EMPTY_FORM);
    setShowForm(true);
    setError(null);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingGame(null);
    setFormData(EMPTY_FORM);
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('تأكيد إلغاء تفعيل اللعبة؟')) return;
    try {
      const res = await apiFetch(`/api/admin/games/${id}/deactivate`, { method: 'POST' });
      if (res.ok) void loadGames();
    } catch {
      setError('فشل إلغاء التفعيل');
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
          <span className="admin-page-kicker">🕹️ إدارة الألعاب</span>
          <h1 className="page-title">الألعاب</h1>
          <p className="hero-subtitle">إدارة ألعاب البطولات التنافسية (الكتالوج)</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-neon text-sm" onClick={() => navigate('/dashboard')}>
            ← مركز التحكم
          </button>
          <AdminGate />
        </div>
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
            <div className="admin-list">
              {games.map((g) => (
                <div key={g.id} className="panel admin-list-row">
                  <div className="admin-list-row-main">
                    <div className="admin-list-thumb">
                      {g.image_url ? (
                        <img src={resolveImageUrl(g.image_url)} alt={g.name_ar} loading="lazy" decoding="async" />
                      ) : (
                        <span aria-hidden="true">🕹️</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="admin-list-title">{g.name_ar}</div>
                      <div className="admin-list-meta">
                        <span className={`badge ${g.is_active ? 'badge-green' : 'badge-red'}`}>
                          {g.is_active ? 'مفعّلة' : 'غير مفعّلة'}
                        </span>
                        <span className="admin-list-meta-item">ترتيب العرض: {g.sort_order}</span>
                      </div>
                    </div>
                  </div>
                  <div className="admin-list-row-actions">
                    <button
                      className="btn-neon text-sm"
                      onClick={() => navigate(`/dashboard/tournaments?gameId=${encodeURIComponent(g.id)}`)}
                    >
                      بطولات اللعبة
                    </button>
                    <button className="btn-neon text-sm" onClick={() => startEdit(g)}>
                      تعديل
                    </button>
                    {g.is_active === 1 && (
                      <button
                        className="btn-neon text-sm admin-btn-danger"
                        onClick={() => handleDeactivate(g.id)}
                      >
                        إلغاء التفعيل
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {games.length === 0 && (
                <div className="panel text-center py-8 text-[var(--text-dim)]">
                  لا توجد ألعاب بعد — ابدأ بإضافة لعبة جديدة.
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="panel admin-form-card">
          <h2 className="page-title mb-4">{editingGame ? 'تعديل اللعبة' : 'إضافة لعبة جديدة'}</h2>

          <form onSubmit={handleSubmit} className="admin-form">
            <section className="admin-form-section">
              <h3 className="admin-form-section-title">بيانات اللعبة</h3>

              <div className="admin-field">
                <label className="admin-field-label" htmlFor="game-name">الاسم</label>
                <input
                  id="game-name"
                  type="text"
                  value={formData.name_ar}
                  onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                  required
                  maxLength={100}
                  className="w-full input-field"
                  placeholder="اكتب اسم اللعبة"
                />
              </div>

              <div className="admin-field">
                <label className="admin-field-label" htmlFor="game-description">الوصف</label>
                <textarea
                  id="game-description"
                  value={formData.description_ar}
                  onChange={(e) => setFormData({ ...formData, description_ar: e.target.value })}
                  className="w-full input-field"
                  rows={3}
                  placeholder="وصف موجز يظهر للاعبين"
                />
              </div>
            </section>

            <section className="admin-form-section">
              <h3 className="admin-form-section-title">الصورة</h3>
              <ImageUploadField
                label="صورة اللعبة"
                category="games"
                value={formData.image_url}
                onChange={(url) => setFormData((prev) => ({ ...prev, image_url: url }))}
                disabled={submitting}
              />
            </section>

            <section className="admin-form-section">
              <h3 className="admin-form-section-title">الإعدادات</h3>
              <div className="admin-form-grid">
                <div className="admin-field">
                  <label className="admin-field-label" htmlFor="game-status">الحالة</label>
                  <select
                    id="game-status"
                    value={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: parseInt(e.target.value) })}
                    className="w-full input-field"
                  >
                    <option value={1}>مفعّلة</option>
                    <option value={0}>غير مفعّلة</option>
                  </select>
                </div>
                <div className="admin-field">
                  <label className="admin-field-label" htmlFor="game-order">ترتيب العرض</label>
                  <input
                    id="game-order"
                    type="number"
                    value={formData.sort_order}
                    onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                    className="w-full input-field"
                    min="0"
                  />
                  <p className="admin-field-hint">الأرقام الأصغر تظهر أولاً.</p>
                </div>
              </div>
            </section>

            <div className="admin-form-actions">
              <button type="button" className="btn-neon" onClick={closeForm}>
                إلغاء
              </button>
              <button type="submit" className="btn-neon" disabled={submitting}>
                {submitting ? 'جاري الحفظ…' : editingGame ? 'حفظ التعديلات' : 'إضافة اللعبة'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
