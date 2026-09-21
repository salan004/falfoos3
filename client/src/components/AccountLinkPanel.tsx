import { useCallback, useEffect, useState } from 'react';
import { useAuthSession } from '../hooks/useAuthSession';
import { apiUrl } from '../utils/api';
import {
  fetchAccountLinkStatus,
  startAccountLink,
  verifyAccountLink,
  type AccountLinkStatus,
  type AccountLinkOperation,
  type LinkStartResult,
} from '../utils/accountLinkApi';

/**
 * Phase 7 / Step 2 — Account <-> EXISTING Player linking UI.
 *
 * Exposes the already-implemented server flow (link/start -> channel challenge
 * -> link/verify) to the current Google account. It intentionally does NOT:
 * - ask for or send a player id / streamlabs id / channel id (the server owns
 *   identity resolution; only `channel` is required by the existing contract),
 * - create a Player when none is linked,
 * - relink or replace an account that is already linked,
 * - reproduce any HMAC/signature/YouTube logic in the browser.
 */

interface AccountLinkPanelProps {
  /** Called after a successful claim so the page can refetch its profile. */
  onLinked?: () => void;
}

type StatusPhase = 'loading' | 'ready' | 'error';
type FlowPhase = 'intro' | 'starting' | 'challenge' | 'verifying';

/** Maps the server's stable machine codes to safe, non-technical Arabic copy. */
function mapLinkError(status: number, code: string): string {
  switch (code) {
    case 'unauthenticated':
      return 'انتهت جلسة الدخول — سجّل الدخول عبر Google ثم أعد المحاولة.';
    case 'invalid_channel':
      return 'أدخل رابط قناة YouTube أو معرّفها بشكل صحيح.';
    case 'invalid_request_id':
    case 'link_request_not_found':
    case 'link_request_failed':
      return 'تعذّر العثور على طلب الربط — ابدأ عملية الربط من جديد.';
    case 'link_request_forbidden':
      return 'طلب الربط لا يخصّ حسابك الحالي.';
    case 'challenge_expired':
      return 'انتهت صلاحية كود التحقق — ابدأ الربط من جديد للحصول على كود جديد.';
    case 'link_challenge_missing':
      return 'لم يُصدر كود تحقق لهذا الطلب — ابدأ من جديد.';
    case 'account_already_linked':
      return 'هذا الحساب مرتبط بلاعب آخر مسبقاً ولا يمكن استبداله تلقائياً. تواصل مع فريق FalFoos للمساعدة.';
    case 'player_claimed_by_other':
      return 'هذا اللاعب مرتبط بحساب آخر مسبقاً ولا يمكن استبداله تلقائياً. تواصل مع فريق FalFoos للمساعدة.';
    case 'player_not_found':
      return 'لا يوجد لاعب FalFoos مرتبط بهذه القناة بعد. تأكد من قناتك ثم أعد المحاولة.';
    case 'link_start_failed':
      return 'تعذّر بدء الربط بهذه القناة. تأكد من رابط القناة ثم أعد المحاولة.';
    case 'link_verify_failed':
    case 'challenge_not_found':
    case 'verification_failed':
    case 'code_not_found':
    case 'description_missing':
    case 'channel_description_missing':
    case 'not_verified':
    case 'verification_pending':
    case 'challenge_not_completed':
      return 'لم نعثر على كود التحقق في وصف قناة YouTube. تأكد من نشره في الوصف ثم أعد التحقق.';
    case 'integration_not_configured':
      return 'خدمة الربط غير متاحة حالياً — حاول لاحقاً.';
    case 'network_error':
      return 'تعذّر الاتصال بالخادم. تحقق من اتصالك ثم أعد المحاولة.';
    default:
      if (status === 401) return 'انتهت جلسة الدخول — سجّل الدخول من جديد.';
      if (status >= 500) return 'تعذّر إكمال العملية الآن. أعد المحاولة بعد قليل.';
      return 'تعذّر إكمال العملية. أعد المحاولة.';
  }
}

export function AccountLinkPanel({ onLinked }: AccountLinkPanelProps) {
  const { user, isLoading: sessionLoading, markClaimed } = useAuthSession();
  const [status, setStatus] = useState<StatusPhase>('loading');
  const [account, setAccount] = useState<AccountLinkStatus | null>(null);
  const [flow, setFlow] = useState<FlowPhase>('intro');
  const [operation, setOperation] = useState<AccountLinkOperation | null>(null);
  const [channel, setChannel] = useState('');
  const [challenge, setChallenge] = useState<LinkStartResult | null>(null);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async (): Promise<void> => {
    setStatus('loading');
    const res = await fetchAccountLinkStatus();
    if (res.ok) {
      setAccount(res.data);
      setStatus('ready');
    } else {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) {
      setAccount(null);
      setStatus('ready');
      return;
    }
    void loadStatus();
  }, [sessionLoading, user, loadStatus]);

  async function handleStart(): Promise<void> {
    if (!operation) {
      setError('اختر هوية اللاعب أولاً.');
      return;
    }
    const value = channel.trim();
    if (!value) {
      setError('أدخل رابط قناة YouTube أو معرّفها أولاً.');
      return;
    }
    setError('');
    setFlow('starting');
    const res = await startAccountLink(value, operation);
    if (res.ok) {
      setChallenge(res.data);
      setFlow('challenge');
      return;
    }
    setFlow('intro');
    if (res.error.code === 'account_already_linked' || res.error.status === 401) {
      void loadStatus();
    }
    setError(mapLinkError(res.error.status, res.error.code));
  }

  async function handleVerify(): Promise<void> {
    if (!challenge) return;
    setError('');
    setFlow('verifying');
    const res = await verifyAccountLink(challenge.request_id);
    if (res.ok) {
      setFlow('intro');
      setChallenge(null);
      setChannel('');
      setOperation(null);
      await loadStatus();
      // F8-FIX — the server already confirmed the link; mirror that into the
      // shared session so the Header "ربط" action disappears immediately
      // (no full page reload). No player identity is sent from the browser.
      markClaimed();
      onLinked?.();
      return;
    }
    setFlow('challenge');
    setError(mapLinkError(res.error.status, res.error.code));
    if (res.error.code === 'account_already_linked' || res.error.status === 401) {
      void loadStatus();
    }
  }

  function resetFlow(): void {
    setFlow('intro');
    setChallenge(null);
    setChannel('');
    setOperation(null);
    setError('');
  }

  const linkedPlayer = account?.linked ? account.player : null;
  const linkedName = linkedPlayer?.display_name || linkedPlayer?.player_id || '';

  return (
    <section
      className={`panel acct-link${linkedPlayer ? ' is-linked' : ''}`}
      aria-label="ربط الحساب بهوية اللاعب"
    >
      <header className="acct-link-head">
        <span className="acct-link-icon" aria-hidden="true">{linkedPlayer ? '🔗' : '🧩'}</span>
        <div className="acct-link-heading">
          <h2 className="acct-link-title">ربط الحساب بهوية اللاعب</h2>
          <p className="acct-link-sub">
            {linkedPlayer
              ? 'حساب Google مرتبط بهوية لاعب FalFoos.'
              : 'اربط حسابك بهوية لاعب على فلفوس. عند ربط هوية موجودة تبقى هويتها وسجلها كما هي وتُضاف إلى حسابك.'}
          </p>
        </div>
      </header>

      {sessionLoading || (user && status === 'loading') ? (
        <p className="acct-link-loading" role="status">جارٍ التحقق من حالة الربط…</p>
      ) : !user ? (
        <div className="acct-link-body">
          <p className="acct-link-text">
            سجّل الدخول عبر Google لتتمكن من ربط حسابك بهوية اللاعب الحالية.
          </p>
          <a className="btn-neon acct-link-btn" href={apiUrl('/api/auth/google')}>
            تسجيل الدخول عبر Google
          </a>
        </div>
      ) : status === 'error' ? (
        <div className="acct-link-body">
          <p className="acct-link-error" role="alert">تعذّر تحميل حالة الربط.</p>
          <button className="btn-neon acct-link-btn" onClick={() => void loadStatus()}>
            إعادة المحاولة
          </button>
        </div>
      ) : linkedPlayer ? (
        <div className="acct-linked-inline" role="status">
          <span className="acct-linked-inline-status">
            <span className="acct-linked-inline-check" aria-hidden="true">✓</span>
            تم ربط الحساب بنجاح
          </span>
          <span className="acct-linked-inline-player">{linkedName}</span>
          <a
            className="acct-linked-inline-action"
            href={`#/profile/${encodeURIComponent(linkedPlayer.player_id)}`}
          >
            عرض ملف اللاعب ←
          </a>
        </div>
      ) : (
        <div className="acct-link-body">
          {(flow === 'challenge' || flow === 'verifying') && challenge ? (
            <>
              <p className="acct-link-instruction">
                ضع هذا الكود في وصف قناة YouTube الخاصة بك
              </p>
              <p className="acct-link-code" dir="ltr">{challenge.code}</p>
              <p className="acct-link-hint">
                انسخ الكود وضعه في وصف القناة، ثم عُد هنا واضغط «تحقق الآن».
              </p>
              {error && <p className="acct-link-error" role="alert">{error}</p>}
              <div className="acct-link-actions">
                <button
                  className="btn-neon acct-link-btn"
                  onClick={() => void handleVerify()}
                  disabled={flow === 'verifying'}
                >
                  {flow === 'verifying' ? 'جارٍ التحقق…' : 'تحقق الآن'}
                </button>
                <button className="nav-link" onClick={resetFlow}>إلغاء</button>
              </div>
            </>
          ) : operation === null ? (
            <>
              <p className="acct-link-instruction">اختر هوية اللاعب</p>
              <div className="acct-link-choices">
                <button
                  type="button"
                  className="acct-link-choice"
                  onClick={() => {
                    setOperation('LINK_EXISTING_PLAYER');
                    setError('');
                  }}
                >
                  <span className="acct-link-choice-icon" aria-hidden="true">🔗</span>
                  <span className="acct-link-choice-title">ربط بهوية لاعب موجودة</span>
                  <span className="acct-link-choice-desc">
                    اربط حسابك بهوية لاعب موجودة على فلفوس مع الحفاظ على سجلها ونقاطها وتصنيفها.
                  </span>
                </button>
                <button
                  type="button"
                  className="acct-link-choice"
                  onClick={() => {
                    setOperation('REGISTER_NEW_PLAYER');
                    setError('');
                  }}
                >
                  <span className="acct-link-choice-icon" aria-hidden="true">🆕</span>
                  <span className="acct-link-choice-title">تسجيل هوية لاعب جديدة</span>
                  <span className="acct-link-choice-desc">
                    أنشئ هوية لاعب جديدة مرتبطة بقناتك، ثم اربطها بحسابك.
                  </span>
                </button>
              </div>
              {error && <p className="acct-link-error" role="alert">{error}</p>}
            </>
          ) : (
            <>
              <p className="acct-link-instruction">
                {operation === 'LINK_EXISTING_PLAYER' ? '🔗 ربط هوية لاعب موجودة' : '🆕 تسجيل هوية لاعب جديدة'}
              </p>
              <ol className="acct-link-steps">
                <li>ابدأ العملية وأدخل رابط قناتك.</li>
                <li>استلم كود التحقق من الموقع.</li>
                <li>ضع الكود في وصف قناة YouTube الخاصة بك.</li>
                <li>عُد إلى الموقع واضغط «تحقق الآن».</li>
                <li>
                  {operation === 'LINK_EXISTING_PLAYER'
                    ? 'سيتم ربط هوية اللاعب الحالية بحسابك.'
                    : 'سيتم إنشاء هوية اللاعب وربطها بحسابك.'}
                </li>
              </ol>
              <label className="acct-link-field" htmlFor="acct-link-channel">
                <span className="acct-link-field-label">رابط قناة YouTube أو معرّفها</span>
                <input
                  id="acct-link-channel"
                  className="acct-link-input"
                  type="text"
                  dir="ltr"
                  placeholder="https://youtube.com/@your-channel"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  disabled={flow === 'starting'}
                />
              </label>
              {error && <p className="acct-link-error" role="alert">{error}</p>}
              <div className="acct-link-actions">
                <button
                  className="btn-neon acct-link-btn"
                  onClick={() => void handleStart()}
                  disabled={flow === 'starting'}
                >
                  {flow === 'starting'
                    ? 'جارٍ بدء العملية…'
                    : operation === 'LINK_EXISTING_PLAYER'
                      ? 'ابدأ الربط'
                      : 'ابدأ التسجيل'}
                </button>
                <button
                  className="nav-link"
                  onClick={() => {
                    setOperation(null);
                    setError('');
                  }}
                >
                  رجوع
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
