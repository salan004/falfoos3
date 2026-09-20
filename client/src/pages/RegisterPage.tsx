import { AccountLinkPanel } from '../components/AccountLinkPanel';
import { ArenaAtmosphere } from '../components/ArenaAtmosphere';
import { useHashRoute } from '../hooks/useHashRoute';

/**
 * Post-Phase 8 — dedicated FalFoos identity / registration experience
 * (`#/register`).
 *
 * Presentation only: it reuses the EXISTING Phase 8 `AccountLinkPanel`
 * (which owns the link/verify API calls, the two operations and every state).
 * No new registration path, no backend identity logic and no client-supplied
 * player_id are introduced here.
 */
export function RegisterPage() {
  const { navigate } = useHashRoute();

  return (
    <main className="page-fade register-page">
      <div className="content-page register-page-inner">
        <ArenaAtmosphere />

        <header className="register-hero">
          <div className="brand-kicker">هوية اللاعب</div>
          <h1 className="hero-title register-title">تسجيل هوية FalFoos</h1>
          <p className="hero-subtitle register-subtitle">
            اربط حساب Google بهوية لاعب FalFoos عبر قناتك على YouTube. هذا إعداد للهوية فقط،
            وليس تسجيلاً في أي بطولة.
          </p>
          <div className="register-bridge" aria-hidden="true">
            <span className="register-bridge-node">Google</span>
            <span className="register-bridge-link" />
            <span className="register-bridge-node is-channel">YouTube</span>
            <span className="register-bridge-link" />
            <span className="register-bridge-node is-player">Player</span>
          </div>
        </header>

        <AccountLinkPanel />

        <p className="register-note">
          تسجيل الدخول عبر Google وحده لا ينشئ لاعباً. يتم إثبات ملكية قناة YouTube عبر كود تحقق
          رسمي من بوت FalFoos قبل الربط أو الإنشاء.
        </p>

        <button type="button" className="nav-link register-back" onClick={() => navigate('/profile')}>
          العودة إلى الملف الشخصي
        </button>
      </div>
    </main>
  );
}
