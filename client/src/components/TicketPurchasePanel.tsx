import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthSession } from '../hooks/useAuthSession';
import { useHashRoute } from '../hooks/useHashRoute';
import { apiUrl } from '../utils/api';
import { fetchAccountLinkStatus, type AccountLinkStatus } from '../utils/accountLinkApi';
import {
  startPurchase,
  fetchPurchaseStatus,
  type PurchaseResult,
} from '../utils/purchaseApi';
import type { TournamentWithGame } from '../types/game';

/**
 * Phase 7 / Step 3 — Tournament Ticket Purchase UI.
 *
 * Exposes the EXISTING website purchase-intent flow. The browser never talks to
 * Streamlabs, never sends an amount/balance/player id, and never decides
 * eligibility: the server + bot own the price, debit, transaction and
 * participant registration. This component only drives the flow and renders
 * the durable state it gets back.
 */

interface TicketPurchasePanelProps {
  gameId: string;
  gameName: string;
  /** Game-scoped tournaments already loaded by the parent (authoritative). */
  tournaments: TournamentWithGame[];
  loading: boolean;
  error: string | null;
  /** Refetch tournaments (participant counts) after a successful purchase. */
  onRefresh: () => void;
}

type Phase = 'idle' | 'confirm' | 'pending' | 'success' | 'failed' | 'recovery';

const MAX_POLLS = 8;

/** Maps the server's stable machine codes to safe, non-technical Arabic copy. */
function mapPurchaseError(status: number, code: string): string {
  switch (code) {
    case 'unauthenticated':
      return 'انتهت جلسة الدخول — سجّل الدخول عبر Google ثم أعد المحاولة.';
    case 'account_not_linked':
      return 'يجب ربط حسابك بلاعب FalFoos أولاً قبل شراء التذاكر.';
    case 'tournament_not_found':
      return 'هذه البطولة غير متاحة الآن.';
    case 'game_mismatch':
      return 'هذه البطولة لا تتبع اللعبة الحالية.';
    case 'tournament_not_open':
      return 'التسجيل غير مفتوح لهذه البطولة.';
    case 'tournament_full':
      return 'اكتمل عدد المشاركين في هذه البطولة.';
    case 'already_registered':
      return 'أنت مسجّل بالفعل في هذه البطولة.';
    case 'insufficient_balance':
      return 'رصيد ولاء Streamlabs غير كافٍ لإتمام الشراء.';
    case 'invalid_request':
      return 'طلب غير صالح — أعد المحاولة.';
    case 'intent_creation_failed':
    case 'integration_not_configured':
      return 'خدمة الشراء غير متاحة حالياً — حاول لاحقاً.';
    case 'network_error':
      return 'تعذّر الاتصال بالخادم. تحقق من اتصالك ثم أعد المحاولة.';
    default:
      if (status === 401) return 'انتهت جلسة الدخول — سجّل الدخول من جديد.';
      if (status === 403) return 'لا تملك صلاحية تنفيذ هذه العملية.';
      if (status >= 500) return 'تعذّر إتمام الشراء الآن. أعد المحاولة بعد قليل.';
      return 'تعذّر إتمام الشراء. أعد المحاولة.';
  }
}

function isFull(t: TournamentWithGame): boolean {
  return t.max_participants !== null && (t.participant_count ?? 0) >= t.max_participants;
}

function formatPoints(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return Number(value).toLocaleString('ar');
}

export function TicketPurchasePanel({
  gameId,
  gameName,
  tournaments,
  loading,
  error,
  onRefresh,
}: TicketPurchasePanelProps) {
  const { navigate } = useHashRoute();
  const { user, isLoading: sessionLoading } = useAuthSession();

  const [linkPhase, setLinkPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [account, setAccount] = useState<AccountLinkStatus | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [selected, setSelected] = useState<TournamentWithGame | null>(null);
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const pollTimer = useRef<number | null>(null);
  const pollCount = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const loadLink = useCallback(async (): Promise<void> => {
    setLinkPhase('loading');
    const res = await fetchAccountLinkStatus();
    if (res.ok) {
      setAccount(res.data);
      setLinkPhase('ready');
    } else {
      setLinkPhase('error');
    }
  }, []);

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) {
      setAccount(null);
      setLinkPhase('ready');
      return;
    }
    void loadLink();
  }, [sessionLoading, user, loadLink]);

  useEffect(() => stopPolling, [stopPolling]);

  const dialogOpen = !!selected && phase !== 'idle';
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogOpen && !dialog.open) dialog.showModal();
    if (!dialogOpen && dialog.open) dialog.close();
  }, [dialogOpen]);

  const finishSuccess = useCallback(
    (r: PurchaseResult): void => {
      stopPolling();
      setResult(r);
      setMessage('');
      setPhase('success');
      onRefresh();
    },
    [onRefresh, stopPolling]
  );

  const finishFailed = useCallback(
    (r: PurchaseResult): void => {
      stopPolling();
      setResult(r);
      setMessage(mapPurchaseError(0, r.error || 'purchase_failed'));
      setPhase('failed');
    },
    [stopPolling]
  );

  const finishRecovery = useCallback(
    (r: PurchaseResult): void => {
      stopPolling();
      setResult(r);
      setMessage(
        'لم تكتمل عملية الشراء بنجاح، ويتعامل النظام مع المعاملة بأمان. لن يتم أي خصم إضافي من رصيدك.'
      );
      setPhase('recovery');
    },
    [stopPolling]
  );

  const schedulePoll = useCallback(
    (requestId: string): void => {
      stopPolling();
      pollCount.current = 0;
      const tick = async (): Promise<void> => {
        pollCount.current += 1;
        const res = await fetchPurchaseStatus(requestId);
        if (res.ok) {
          const r = res.data;
          if (r.status === 'PARTICIPANT_REGISTERED') return finishSuccess(r);
          if (r.status === 'FAILED') return finishFailed(r);
          if (r.status === 'REFUND_REQUESTED' || r.status === 'REFUNDED') return finishRecovery(r);
        } else if (res.error.status === 401 || res.error.code === 'unauthenticated') {
          stopPolling();
          setPhase('failed');
          setMessage(mapPurchaseError(res.error.status, res.error.code));
          return;
        }
        if (pollCount.current >= MAX_POLLS) {
          setMessage('ما زالت العملية قيد المعالجة الآمنة — يمكنك تحديث الحالة بعد قليل.');
          return;
        }
        pollTimer.current = window.setTimeout(() => void tick(), 2500);
      };
      pollTimer.current = window.setTimeout(() => void tick(), 2000);
    },
    [finishFailed, finishRecovery, finishSuccess, stopPolling]
  );

  const applyResult = useCallback(
    (r: PurchaseResult): void => {
      setResult(r);
      if (r.status === 'PARTICIPANT_REGISTERED') {
        finishSuccess(r);
        return;
      }
      if (r.status === 'FAILED') {
        finishFailed(r);
        return;
      }
      if (r.status === 'REFUND_REQUESTED' || r.status === 'REFUNDED') {
        finishRecovery(r);
        return;
      }
      // INTENT_CREATED / BOT_REQUESTED / BOT_DEBIT_CONFIRMED / PENDING_RECOVERY
      setPhase('pending');
      setMessage('جارٍ تنفيذ عملية الشراء عبر البوت… لا تُغلق النافذة.');
      schedulePoll(r.request_id);
    },
    [finishFailed, finishRecovery, finishSuccess, schedulePoll]
  );

  function openConfirm(t: TournamentWithGame): void {
    setSelected(t);
    setResult(null);
    setMessage('');
    setPhase('confirm');
  }

  const closeModal = useCallback((): void => {
    if (busy || phase === 'pending') return;
    stopPolling();
    setPhase('idle');
    setSelected(null);
    setResult(null);
    setMessage('');
  }, [busy, phase, stopPolling]);

  async function confirmPurchase(): Promise<void> {
    if (!selected || busy) return;
    setBusy(true);
    setMessage('');
    setPhase('pending');
    const res = await startPurchase(selected.id, selected.game_id);
    setBusy(false);
    if (!res.ok) {
      if (res.error.code === 'account_not_linked') {
        // Hand off to the Step 2 linking gate instead of a dead-end retry.
        stopPolling();
        setPhase('idle');
        setSelected(null);
        setResult(null);
        setMessage('');
        void loadLink();
        return;
      }
      setPhase('failed');
      setMessage(mapPurchaseError(res.error.status, res.error.code));
      return;
    }
    applyResult(res.data);
  }

  async function refreshStatus(): Promise<void> {
    const requestId = result?.request_id;
    if (!requestId || busy) return;
    setBusy(true);
    const res = await fetchPurchaseStatus(requestId);
    setBusy(false);
    if (!res.ok) {
      setMessage(mapPurchaseError(res.error.status, res.error.code));
      return;
    }
    applyResult(res.data);
  }

  function handleDialogCancel(e: React.SyntheticEvent<HTMLDialogElement>): void {
    e.preventDefault();
    closeModal();
  }

  function handleBackdrop(e: React.MouseEvent<HTMLDialogElement>): void {
    if (e.target === dialogRef.current) closeModal();
  }

  // Scope to the current game by the authoritative FK (never by display name),
  // then to tournaments the backend actually allows purchasing from.
  const openTournaments = tournaments.filter((t) => t.game_id === gameId && t.status === 'open');

  return (
    <section className="gh-section ticket-section" aria-label="شراء تذاكر البطولات">
      <div className="game-hub-section-head">
        <h2 className="section-title">🎟️ شراء التذاكر</h2>
        <span className="ticket-section-game">
          {gameName || 'هذه اللعبة'}
        </span>
      </div>

      {sessionLoading ? (
        <div className="panel text-center py-12 loading-pulse text-[var(--text-dim)]">
          جارٍ التحقق من الحساب…
        </div>
      ) : !user ? (
        <div className="panel ticket-gate">
          <span className="ticket-gate-icon" aria-hidden="true">🔐</span>
          <h3 className="ticket-gate-title">سجّل الدخول لشراء التذاكر</h3>
          <p className="ticket-gate-text">
            استخدم حساب Google الخاص بك لإتمام عملية شراء التذكرة.
          </p>
          <a className="btn-neon" href={apiUrl('/api/auth/google')}>
            تسجيل الدخول عبر Google
          </a>
        </div>
      ) : linkPhase === 'loading' ? (
        <div className="panel text-center py-12 loading-pulse text-[var(--text-dim)]">
          جارٍ التحقق من ربط الحساب…
        </div>
      ) : linkPhase === 'error' ? (
        <div className="panel ticket-gate">
          <p className="ticket-gate-text">تعذّر التحقق من حالة الربط.</p>
          <button className="btn-neon" onClick={() => void loadLink()}>إعادة المحاولة</button>
        </div>
      ) : !account?.linked ? (
        <div className="panel ticket-gate">
          <span className="ticket-gate-icon" aria-hidden="true">🧩</span>
          <h3 className="ticket-gate-title">اربط حسابك بلاعب FalFoos أولاً</h3>
          <p className="ticket-gate-text">
            تحتاج إلى ربط حساب Google بهوية لاعب FalFoos موجودة قبل شراء تذاكر البطولات.
          </p>
          <button className="btn-neon" onClick={() => navigate('/profile')}>
            الانتقال إلى ربط الحساب
          </button>
        </div>
      ) : loading ? (
        <div className="panel text-center py-12 loading-pulse text-[var(--text-dim)]">
          جارٍ تحميل البطولات…
        </div>
      ) : error ? (
        <div className="panel text-center py-12 text-[var(--text-dim)]">{error}</div>
      ) : openTournaments.length === 0 ? (
        <div className="panel text-center py-12 text-[var(--text-dim)]">
          لا توجد بطولات متاحة لشراء التذاكر في هذه اللعبة حاليًا
        </div>
      ) : (
        <div className="games-grid gh-tournaments-grid">
          {openTournaments.map((t) => {
            const full = isFull(t);
            const count = t.participant_count ?? 0;
            return (
              <article key={t.id} className="card ticket-card text-right">
                <div className="ticket-card-top">
                  <span className="badge badge-green">التسجيل مفتوح</span>
                  <span className="badge badge-yellow">
                    👥 {count.toLocaleString('ar')}
                    {t.max_participants ? ` / ${t.max_participants.toLocaleString('ar')}` : ''}
                  </span>
                </div>
                <h3 className="ticket-card-title">{t.name_ar}</h3>
                <p className="ticket-card-game">🎮 {t.game_name_ar || gameName || gameId}</p>
                <p className="ticket-card-price">
                  💳 يُخصم سعر التذكرة من رصيد ولاء Streamlabs عبر البوت الموثوق
                </p>
                <div className="ticket-card-actions">
                  <button
                    className="btn-neon ticket-buy-btn"
                    onClick={() => openConfirm(t)}
                    disabled={full}
                  >
                    {full ? 'اكتمل العدد' : 'شراء التذكرة'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <dialog
        ref={dialogRef}
        className="ticket-modal"
        onClick={handleBackdrop}
        onCancel={handleDialogCancel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-modal-title"
      >
        {selected && (
          <div className="ticket-modal-content">
            <header className="ticket-modal-head">
              <h3 id="ticket-modal-title" className="ticket-modal-title">
                {phase === 'success'
                  ? 'تم شراء التذكرة'
                  : phase === 'failed'
                    ? 'تعذّر إتمام الشراء'
                    : phase === 'recovery'
                      ? 'معالجة آمنة للمعاملة'
                      : 'تأكيد شراء التذكرة'}
              </h3>
              {phase !== 'pending' && (
                <button className="ticket-modal-close" onClick={closeModal} aria-label="إغلاق">
                  ✕
                </button>
              )}
            </header>

            {phase === 'confirm' && (
              <>
                <dl className="ticket-modal-rows">
                  <div>
                    <dt>البطولة</dt>
                    <dd>{selected.name_ar}</dd>
                  </div>
                  <div>
                    <dt>اللعبة</dt>
                    <dd>{selected.game_name_ar || gameName || gameId}</dd>
                  </div>
                  <div>
                    <dt>التكلفة</dt>
                    <dd>يُخصم سعر التذكرة من رصيد ولاء Streamlabs عبر البوت الموثوق</dd>
                  </div>
                </dl>
                <p className="ticket-modal-note">
                  عند التأكيد سيُخصم سعر التذكرة من رصيد ولاء Streamlabs الخاص بك، وسيتم
                  تسجيلك مباشرةً في البطولة عند نجاح العملية.
                </p>
              </>
            )}

            {phase === 'pending' && (
              <div className="ticket-modal-state">
                <span className="ticket-spinner" aria-hidden="true" />
                <p className="ticket-modal-text">{message}</p>
              </div>
            )}

            {phase === 'success' && (
              <div className="ticket-modal-state is-success">
                <span className="ticket-modal-glyph" aria-hidden="true">✓</span>
                <p className="ticket-modal-text">
                  تم شراء التذكرة وتسجيلك في بطولة «{selected.name_ar}».
                </p>
                {result?.amount !== null && result?.amount !== undefined && (
                  <p className="ticket-modal-meta">
                    المبلغ المخصوم: {formatPoints(result.amount)} نقطة ولاء
                    {result.balance_after !== null && result.balance_after !== undefined
                      ? ` · الرصيد المتبقي: ${formatPoints(result.balance_after)}`
                      : ''}
                  </p>
                )}
              </div>
            )}

            {phase === 'failed' && (
              <div className="ticket-modal-state is-error">
                <span className="ticket-modal-glyph" aria-hidden="true">!</span>
                <p className="ticket-modal-text">{message}</p>
              </div>
            )}

            {phase === 'recovery' && (
              <div className="ticket-modal-state is-recovery">
                <span className="ticket-modal-glyph" aria-hidden="true">↺</span>
                <p className="ticket-modal-text">{message}</p>
              </div>
            )}

            <footer className="ticket-modal-footer">
              {phase === 'confirm' && (
                <>
                  <button className="btn-neon" onClick={() => void confirmPurchase()} disabled={busy}>
                    تأكيد الشراء
                  </button>
                  <button className="nav-link" onClick={closeModal}>إلغاء</button>
                </>
              )}
              {phase === 'pending' && (
                <button className="nav-link" onClick={() => void refreshStatus()} disabled={busy}>
                  تحديث الحالة
                </button>
              )}
              {phase === 'success' && (
                <>
                  <button className="btn-neon" onClick={() => navigate(`/tournaments/${selected.id}`)}>
                    عرض البطولة
                  </button>
                  <button className="nav-link" onClick={closeModal}>إغلاق</button>
                </>
              )}
              {phase === 'failed' && (
                <>
                  <button className="btn-neon" onClick={() => void confirmPurchase()} disabled={busy}>
                    إعادة المحاولة
                  </button>
                  <button className="nav-link" onClick={closeModal}>إغلاق</button>
                </>
              )}
              {phase === 'recovery' && (
                <>
                  <button className="nav-link" onClick={() => void refreshStatus()} disabled={busy}>
                    تحديث الحالة
                  </button>
                  <button className="nav-link" onClick={closeModal}>إغلاق</button>
                </>
              )}
            </footer>
          </div>
        )}
      </dialog>
    </section>
  );
}
