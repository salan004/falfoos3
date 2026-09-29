import { useEffect, useState } from 'react';
import {
  demoteModerator,
  listModerators,
  promoteModerator,
  searchPromotableUsers,
  setModeratorCanCreateTournaments,
  type Moderator,
  type PromotableUser,
} from '../../utils/adminPermissionsApi';
import { resolveImageUrl } from '../../utils/api';

/**
 * Admin Control & Permissions — SUPER_ADMIN moderator management.
 *
 * Every change is persisted server-side (`admin_permissions`) and the UI is
 * re-seeded from the server response; nothing is held in local-only state.
 */
export function ModeratorManager() {
  const [moderators, setModerators] = useState<Moderator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PromotableUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchTouched, setSearchTouched] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await listModerators();
    if (res.ok && res.data) {
      setModerators(res.data.moderators);
      setError(null);
    } else {
      setError('تعذّر تحميل قائمة المشرفين');
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const runSearch = async (value: string) => {
    setQuery(value);
    setSearchTouched(true);
    if (value.trim().length === 0) {
      setResults([]);
      return;
    }
    setSearching(true);
    const res = await searchPromotableUsers(value);
    setSearching(false);
    if (res.ok && res.data) {
      setResults(res.data.users);
    } else {
      setResults([]);
    }
  };

  const promote = async (userId: string) => {
    setBusyId(userId);
    const res = await promoteModerator(userId);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error === 'already_moderator' ? 'هذا المستخدم مشرف بالفعل' : 'تعذّرت إضافة المشرف');
      return;
    }
    setError(null);
    setQuery('');
    setResults([]);
    setSearchTouched(false);
    await load();
  };

  const toggleCreate = async (moderator: Moderator) => {
    setBusyId(moderator.userId);
    const res = await setModeratorCanCreateTournaments(moderator.userId, !moderator.canCreateTournaments);
    setBusyId(null);
    if (!res.ok || !res.data) {
      setError('تعذّر تحديث الصلاحية');
      return;
    }
    setError(null);
    setModerators((prev) =>
      prev.map((m) => (m.userId === moderator.userId ? res.data!.moderator : m))
    );
  };

  const remove = async (moderator: Moderator) => {
    if (!confirm(`إزالة صلاحيات المشرف عن «${moderator.displayName}»؟\nسيعود المستخدم إلى حساب عادي دون حذف بياناته.`)) {
      return;
    }
    setBusyId(moderator.userId);
    const res = await demoteModerator(moderator.userId);
    setBusyId(null);
    if (!res.ok) {
      setError('تعذّرت إزالة المشرف');
      return;
    }
    setError(null);
    await load();
  };

  return (
    <section className="admin-mods" aria-label="إدارة المشرفين">
      <div className="admin-mods-head">
        <h2 className="admin-mods-title">المشرفون</h2>
        <p className="admin-mods-sub">
          حوّل مستخدمًا موجودًا إلى مشرف محدود الصلاحيات، وتحكّم بسماح إنشاء البطولات لكل مشرف.
        </p>
      </div>

      {error && <div className="admin-mods-error">{error}</div>}

      <div className="admin-mods-add">
        <label className="admin-field-label" htmlFor="moderator-search">
          إضافة مشرف — ابحث عن مستخدم موجود
        </label>
        <input
          id="moderator-search"
          type="text"
          className="input-field"
          value={query}
          onChange={(e) => void runSearch(e.target.value)}
          placeholder="اكتب اسم المستخدم للبحث…"
          autoComplete="off"
        />

        {searching && <div className="admin-mods-hint">جارٍ البحث…</div>}
        {!searching && searchTouched && query.trim() && results.length === 0 && (
          <div className="admin-mods-hint">لا يوجد مستخدم مطابق (يجب ألا يكون مشرفًا بالفعل).</div>
        )}

        {results.length > 0 && (
          <ul className="admin-mods-results">
            {results.map((u) => (
              <li key={u.userId} className="admin-mods-result">
                <span className="admin-mods-avatar" aria-hidden>
                  {u.avatarUrl ? <img src={resolveImageUrl(u.avatarUrl)} alt="" /> : u.displayName.charAt(0)}
                </span>
                <span className="admin-mods-result-name">{u.displayName}</span>
                <button
                  type="button"
                  className="btn-neon text-sm"
                  disabled={busyId === u.userId}
                  onClick={() => void promote(u.userId)}
                >
                  تعيين كمشرف
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {loading ? (
        <div className="admin-mods-hint">جارٍ التحميل…</div>
      ) : moderators.length === 0 ? (
        <div className="admin-mods-hint">لا يوجد مشرفون محدودون بعد.</div>
      ) : (
        <ul className="admin-mods-list">
          {moderators.map((m) => (
            <li key={m.userId} className="admin-mods-row">
              <span className="admin-mods-avatar" aria-hidden>
                {m.avatarUrl ? <img src={resolveImageUrl(m.avatarUrl)} alt="" /> : m.displayName.charAt(0)}
              </span>
              <span className="admin-mods-name">{m.displayName}</span>

              <div className="admin-mods-perm">
                <span className="admin-mods-perm-label">السماح بإنشاء البطولات</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={m.canCreateTournaments}
                  className={`admin-switch ${m.canCreateTournaments ? 'is-on' : 'is-off'}`}
                  disabled={busyId === m.userId}
                  onClick={() => void toggleCreate(m)}
                >
                  <span className="admin-switch-track" aria-hidden>
                    <span className="admin-switch-thumb" />
                  </span>
                  <span className="admin-switch-state">
                    {m.canCreateTournaments ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>

              <button
                type="button"
                className="admin-mods-remove"
                disabled={busyId === m.userId}
                onClick={() => void remove(m)}
              >
                إزالة
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
