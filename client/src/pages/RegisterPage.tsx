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
 *
 * F7 — UX/content only: the page now clearly separates the three identity
 * layers (Google account = website sign-in, YouTube channel = ownership proof,
 * player identity = the canonical competitive identity) and explains why the
 * user links an account to a player identity.
 */
export function RegisterPage() {
  const { navigate } = useHashRoute();

  return (
    <main className="page-fade register-page">
      <div className="content-page register-page-inner">
        <ArenaAtmosphere />

        <header className="register-hero">
          <div className="brand-kicker">هوية اللاعب</div>
          <h1 className="hero-title register-title">ربط حسابك بموقع فلفوس</h1>
          <p className="hero-subtitle register-subtitle">
            اربط حسابك في فلفوس بهوية لاعبك، لتصبح مشاركاتك وبياناتك التنافسية تحت هوية واحدة.
            هذه عملية ربط هوية فقط، وليست تسجيلاً في بطولة.
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
          <ul className="acct-link-steps">
            <li>هوية اللاعب هي هويتك داخل موقع فلفوس، وترتبط بها مشاركاتك في البطولات وبياناتك التنافسية.</li>
            <li>ربط حسابك بهوية موجودة يحافظ على الهوية وسجلها، ولا ينشئ هوية جديدة.</li>
            <li>تسجيل هوية جديدة ينشئ هوية جديدة مرتبطة بقناتك.</li>
            <li>التحقق من قناة YouTube يثبت ملكية الهوية، وحساب Google يُستخدم لتسجيل الدخول إلى الموقع.</li>
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
