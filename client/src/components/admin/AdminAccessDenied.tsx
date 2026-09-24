import { useRoute } from '../../hooks/useRoute';

/**
 * Phase F1 — defined access-denied state for Admin routes.
 *
 * Replaces the previous silent `return null` (blank page) with a clear,
 * on-brand message. Authentication/authorization itself is unchanged.
 */
export function AdminAccessDenied() {
  const { navigate } = useRoute();

  return (
    <main className="page" style={{ maxWidth: 560 }}>
      <div className="admin-access-denied panel">
        <span className="admin-access-denied-icon" aria-hidden="true">🔒</span>
        <h1 className="admin-access-denied-title">لا تملك صلاحية الوصول</h1>
        <p className="admin-access-denied-text">
          هذه الصفحة مخصّصة لمشرفي FalFoos فقط. سجّل الدخول بحساب مشرف مُوثّق للمتابعة.
        </p>
        <button className="btn-neon" onClick={() => navigate('/')}>
          العودة إلى الرئيسية
        </button>
      </div>
    </main>
  );
}
