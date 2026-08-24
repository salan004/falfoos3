import { useEffect, useState } from 'react';
import { onAdminAuthResult, sendAdminAuth } from '../utils/socket';
import { useAuthSession } from '../hooks/useAuthSession';

const TOKEN_KEY = 'falfoos_admin_token';

type AuthState = 'pending' | 'authorized' | 'denied';

/**
 * Phase 9A/11F — admin unlock for Control Panel / Connect page.
 *
 * Consolidation (Phase 11F): registered users with role='admin' are the
 * PRIMARY path — their commands are accepted server-side via the verified
 * session identity, so the gate shows an automatic unlocked badge.
 * ADMIN_TOKEN remains permanently available as a break-glass fallback,
 * collapsed behind an explicit «طوارئ» toggle. The token lives only in this
 * browser tab (sessionStorage) and authorizes a single socket connection.
 */
export function AdminGate() {
  const { user, isLoading } = useAuthSession();
  const isRoleAdmin = user?.role === 'admin';
  const [authState, setAuthState] = useState<AuthState>('pending');
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? '');
  const [showEmergency, setShowEmergency] = useState(false);

  useEffect(() => {
    if (isRoleAdmin) return undefined;
    const off = onAdminAuthResult((result) => {
      if (result?.ok) {
        setAuthState('authorized');
        setShowEmergency(false);
      } else {
        setAuthState('denied');
        sessionStorage.removeItem(TOKEN_KEY);
      }
    });
    const stored = sessionStorage.getItem(TOKEN_KEY);
    if (stored) sendAdminAuth(stored);
    return off;
  }, [isRoleAdmin]);

  const submit = () => {
    const trimmed = token.trim();
    if (!trimmed) return;
    sessionStorage.setItem(TOKEN_KEY, trimmed);
    setAuthState('pending');
    sendAdminAuth(trimmed);
  };

  // Primary path — verified registered admin (server-side role check).
  if (isLoading) return null;
  if (isRoleAdmin) {
    return (
      <button
        className="badge badge-green text-xs"
        style={{ cursor: 'pointer', background: 'rgba(0,255,136,0.12)' }}
        onClick={() => setShowEmergency((v) => !v)}
        title="حساب مشرف مُوثّق — الأدوات مفعّلة تلقائياً"
      >
        🔓 مشرف
      </button>
    );
  }

  // Break-glass path — emergency ADMIN_TOKEN entry (collapsed by default).
  if (!showEmergency) {
    if (authState === 'authorized') {
      return (
        <button
          className="badge badge-green text-xs"
          style={{ cursor: 'pointer', background: 'rgba(0,255,136,0.12)' }}
          onClick={() => setShowEmergency(true)}
          title="جلسة طوارئ مفعّلة — اضغط لإعادة الإدخال"
        >
          🔓 طوارئ
        </button>
      );
    }
    return (
      <button
        className="badge text-xs"
        style={{ cursor: 'pointer', color: 'var(--text-dim)' }}
        onClick={() => setShowEmergency(true)}
        title="فتح إدخال رمز المشرف الطارئ"
      >
        ⚠️ طوارئ
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {authState === 'authorized' ? (
        <span className="badge badge-green text-xs" style={{ background: 'rgba(0,255,136,0.12)' }}>
          🔓 طوارئ
        </span>
      ) : (
        authState === 'denied' && <span className="text-[var(--neon-red)] text-xs">رمز خاطئ</span>
      )}
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="رمز المشرف"
        className="w-32 text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan"
        aria-label="رمز المشرف"
      />
      <button className="btn-neon text-sm" onClick={submit}>
        🔑 دخول
      </button>
      <button
        className="text-xs text-[var(--text-dim)]"
        onClick={() => setShowEmergency(false)}
        title="إخفاء"
      >
        ✕
      </button>
    </div>
  );
}
