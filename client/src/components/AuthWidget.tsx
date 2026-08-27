import { apiFetch } from '../utils/api';
import { useState } from 'react';
import { useAuthSession } from '../hooks/useAuthSession';
import { useGuestIdentity } from '../hooks/useGuestIdentity';
import { PlayerAvatar } from './PlayerAvatar';

/**
 * Phase 11C: optional Google sign-in widget in the main navigation.
 * Phase 11D: adds the Tier-2 claim flow — an authenticated user requests a
 * short code and posts it in the live chat from their own channel to bind
 * their guest identity (and its scores) to their account. Guests stay
 * first-class: none of this is required to play.
 */

type ClaimPhase = 'idle' | 'pending' | 'waiting' | 'checking' | 'done' | 'error';

const CLAIM_ERRORS: Record<string, string> = {
  notConnected: 'لا يوجد اتصال بالدردشة حالياً — جرّب بعد تشغيل البث.',
  invalidCode: 'كود غير صالح.',
  noChallenge: 'ابدأ عملية الربط أولاً.',
  expired: 'انتهت صلاحية الكود — اطلب كوداً جديداً.',
  noAttempts: 'تم تجاوز عدد المحاولات — اطلب كوداً جديداً.',
  codeNotFound: 'لم نجد الكود في الدردشة بعد — تأكد من النشر ثم أعد المحاولة.',
  claimedByOther: 'هذه الهوية مرتبطة بحساب آخر مسبقاً.',
  rateLimited: 'محاولات كثيرة — انتقل قليلاً ثم أعد المحاولة.',
};

export function AuthWidget() {
  const { user, guestLinked, isLoading, logout, markClaimed } = useAuthSession();
  useGuestIdentity();
  const [claimPhase, setClaimPhase] = useState<ClaimPhase>('idle');
  const [claimCode, setClaimCode] = useState('');
  const [claimError, setClaimError] = useState('');

  if (isLoading) return null;

  async function startClaim(): Promise<void> {
    setClaimError('');
    try {
      const res = await apiFetch('/api/auth/claim/start', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setClaimPhase('error');
        setClaimError(CLAIM_ERRORS[data.error ?? ''] ?? 'تعذّر بدء الربط.');
        return;
      }
      // Format as XXXX-XXXX for readability; server compares normalized.
      const raw = String(data.code ?? '');
      setClaimCode(raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw);
      setClaimPhase('waiting');
    } catch {
      setClaimPhase('error');
      setClaimError('تعذّر الاتصال بالخادم.');
    }
  }

  async function checkClaim(): Promise<void> {
    setClaimPhase('checking');
    try {
      const res = await apiFetch('/api/auth/claim/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: claimCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.status === 'claimed' || data.status === 'alreadyClaimed')) {
        markClaimed();
        setClaimPhase('done');
        return;
      }
      setClaimPhase('error');
      setClaimError(CLAIM_ERRORS[data.error ?? ''] ?? 'تعذّر التحقق.');
    } catch {
      setClaimPhase('error');
      setClaimError('تعذّر الاتصال بالخادم.');
    }
  }

  function closePanel(): void {
    setClaimPhase('idle');
    setClaimCode('');
    setClaimError('');
  }

  if (!user) {
    return (
      <a
        className="nav-link auth-signin"
        href="https://api-falfoos.duckdns.org/api/auth/google"
        title="تسجيل الدخول عبر Google"
      >
        تسجيل الدخول
      </a>
    );
  }

  return (
    <div className="auth-user" dir="ltr">
      {/* Phase 12C — the chip opens the player's profile (#/profile). */}
      <a className="auth-profile-link" href="#/profile" title="ملفي الشخصي">
        <PlayerAvatar id={user.id} name={user.displayName} avatarUrl={user.avatarUrl ?? undefined} size={30} />
        <span className="auth-name">{user.displayName}</span>
      </a>
      {claimPhase === 'idle' && !guestLinked && (
        <button className="nav-link" onClick={() => void startClaim()} title="ربط هوية الضيف بحسابك">
          ربط
        </button>
      )}
      <button
        className="nav-link"
        onClick={() => {
          void logout();
        }}
        title="تسجيل الخروج"
      >
        خروج
      </button>

      {(claimPhase === 'waiting' || claimPhase === 'checking' || claimPhase === 'done' || claimPhase === 'error') && (
        <div className="auth-claim-panel" dir="rtl" role="dialog">
          {claimPhase === 'done' ? (
            <>
              <p className="auth-claim-title">تم ربط الحساب بنجاح ✓</p>
              <p className="auth-claim-hint">نقاطك السابقة تُحتسب الآن لحسابك.</p>
              <button className="nav-link" onClick={closePanel}>إغلاق</button>
            </>
          ) : (
            <>
              <p className="auth-claim-title">اربط هويتك بحسابك</p>
              <p className="auth-claim-code">{claimCode}</p>
              <p className="auth-claim-hint">
                انشر هذا الكود في الدردشة المباشرة من قناتك، ثم اضغط تحقّق.
              </p>
              {claimError && <p className="auth-claim-error">{claimError}</p>}
              <div className="auth-claim-actions">
                <button
                  className="nav-link"
                  disabled={claimPhase === 'checking'}
                  onClick={() => void checkClaim()}
                >
                  {claimPhase === 'checking' ? 'جارٍ التحقق…' : 'تحقّق'}
                </button>
                <button className="nav-link" onClick={() => void startClaim()}>كود جديد</button>
                <button className="nav-link" onClick={closePanel}>إلغاء</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
