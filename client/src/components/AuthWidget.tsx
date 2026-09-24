import { apiUrl } from '../utils/api';
import { useAuthSession } from '../hooks/useAuthSession';
import { useGuestIdentity } from '../hooks/useGuestIdentity';
import { useRoute } from '../hooks/useRoute';
import { PlayerAvatar } from './PlayerAvatar';
import { Link } from './Link';

/**
 * Phase 11C: optional Google sign-in widget in the main navigation.
 *
 * Phase F6 — the Header "ربط" action now routes the authenticated user to the
 * existing registration/linking experience (`#/register` → `AccountLinkPanel`),
 * which performs canonical player linking through the bot-backed YouTube
 * channel-description verification. The obsolete LIVE CHAT claim UI and its
 * client-only state were removed from this component.
 *
 * The backend `/api/auth/claim/*` infrastructure is intentionally retained
 * (this phase only changes the Header entry point; backend cleanup is a
 * separate decision).
 */
export function AuthWidget() {
  const { user, guestLinked, isLoading, logout } = useAuthSession();
  const { navigate } = useRoute();
  useGuestIdentity();

  if (isLoading) return null;

  if (!user) {
    return (
      <a
        className="nav-link auth-signin"
        href={apiUrl('/api/auth/google')}
        title="تسجيل الدخول عبر Google"
      >
        تسجيل الدخول
      </a>
    );
  }

  return (
    <div className="auth-user" dir="ltr">
      {/* Phase 12C — the chip opens the player's profile (/profile). */}
      <Link className="auth-profile-link" to="/profile" title="ملفي الشخصي">
        <PlayerAvatar id={user.id} name={user.displayName} avatarUrl={user.avatarUrl ?? undefined} size={30} />
        <span className="auth-name">{user.displayName}</span>
      </Link>
      {!guestLinked && (
        <button
          className="nav-link"
          onClick={() => {
            navigate('/register');
          }}
          title="ربط حسابك بهوية لاعب FalFoos"
        >
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
    </div>
  );
}
