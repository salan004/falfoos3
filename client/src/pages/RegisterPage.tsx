import { AccountLinkPanel } from '../components/AccountLinkPanel';
import { ArenaAtmosphere } from '../components/ArenaAtmosphere';
import { useRoute } from '../hooks/useRoute';

/**
 * Post-Phase 8 — dedicated FalFoos identity / registration experience
 * (`#/register`).
 *
 * Presentation only: it reuses the EXISTING Phase 8 `AccountLinkPanel`
 * (which owns the link/verify API calls, the two operations and every state).
 * No new registration path, no backend identity logic and no client-supplied
 * player_id are introduced here.
 *
 * F7 — UX/content only: the page now clearly separates the three identity
 * layers (Google account = website sign-in, YouTube channel = ownership proof,
 * player identity = the canonical competitive identity) and explains why the
 * user links an account to a player identity.
 */
export function RegisterPage() {
  const { navigate } = useRoute();

  return (
    <main className="page-fade register-page">
      <div className="content-page register-page-inner">
        <ArenaAtmosphere />

        <header className="register-hero register-intro">
          <span className="acct-link-icon register-intro-icon" aria-hidden="true">🔗</span>
          <div className="brand-kicker">هوية اللاعب</div>
          <h1 className="hero-title register-title">ربط حسابك بموقع فلفوس</h1>
          <p className="hero-subtitle register-subtitle">
            اربط حسابك بهوية لاعبك في فلفوس لتوحيد مشاركاتك وبياناتك التنافسية تحت هوية واحدة.
          </p>
          <div className="register-bridge" aria-hidden="true">
            <span className="register-bridge-node">حساب Google</span>
            <span className="register-bridge-link" />
            <span className="register-bridge-node is-channel">قناة YouTube</span>
            <span className="register-bridge-link" />
            <span className="register-bridge-node is-player">هوية اللاعب</span>
          </div>
        </header>

        <section className="register-why" aria-labelledby="register-why-title">
          <h2 id="register-why-title" className="register-why-title">لماذا تربط حسابك؟</h2>
          <ul className="register-why-list">
            <li>
              <span className="acct-link-choice-icon" aria-hidden="true">🧩</span>
              <span className="acct-link-choice-title">هوية موحّدة</span>
              <span className="acct-link-choice-desc">
                هوية اللاعب هي هويتك في فلفوس، وترتبط بها مشاركاتك وبياناتك التنافسية.
              </span>
            </li>
            <li>
              <span className="acct-link-choice-icon" aria-hidden="true">🔗</span>
              <span className="acct-link-choice-title">ربط يحافظ على سجلك</span>
              <span className="acct-link-choice-desc">
                اربط حسابك بهوية موجودة وحافظ على الهوية وسجلها دون إنشاء هوية جديدة.
              </span>
            </li>
            <li>
              <span className="acct-link-choice-icon" aria-hidden="true">🆕</span>
              <span className="acct-link-choice-title">تسجيل هوية جديدة</span>
              <span className="acct-link-choice-desc">
                إذا لم تكن لديك هوية لاعب، يمكنك تسجيل هوية جديدة مرتبطة بقناتك.
              </span>
            </li>
            <li>
              <span className="acct-link-choice-icon" aria-hidden="true">🛡️</span>
              <span className="acct-link-choice-title">تحقق آمن</span>
              <span className="acct-link-choice-desc">
                التحقق من قناة YouTube يثبت ملكية الهوية، بينما يُستخدم حساب Google لتسجيل الدخول.
              </span>
            </li>
          </ul>
        </section>

        <AccountLinkPanel />

        <p className="register-note">
          تسجيل الدخول عبر Google لا ينشئ هوية لاعب. تُثبت ملكية قناة YouTube عبر كود تحقق
          من بوت فلفوس قبل الربط أو الإنشاء.
        </p>

        <button type="button" className="nav-link register-back" onClick={() => navigate('/profile')}>
          العودة إلى الملف الشخصي
        </button>
      </div>
    </main>
  );
}
