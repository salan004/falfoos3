import { SOCIAL_LINKS } from '../data/socialLinks';

/**
 * Phase 12F — the owner's links page. Premium glass presentation over
 * SOCIAL_LINKS (order defined in data/socialLinks.ts); anchors keep plain
 * external behaviour — no router navigation.
 */
export function LinksPage() {
  return (
    <main className="page-fade">
      <div className="content-page">
        <header className="lk-hero">
          <span className="lk-hero-glyph" aria-hidden="true">🔗</span>
          <h1 className="lk-title">روابط FalFoos</h1>
          <p className="lk-subtitle">تابع حساباتنا الرسمية وانضم إلى مجتمع FalFoos</p>
        </header>

        {SOCIAL_LINKS.length === 0 ? (
          <div
            className="panel"
            style={{ textAlign: 'center', padding: '46px 20px', color: 'var(--text-dim)' }}
          >
            <div style={{ fontSize: '1.6rem', marginBottom: 10 }}>🔗</div>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
              لا توجد روابط منشورة بعد
            </div>
            <div style={{ fontSize: '0.85rem' }}>
              ستظهر حسابات ومنصات FalFoos هنا قريباً.
            </div>
          </div>
        ) : (
          <div className="links-grid">
            {SOCIAL_LINKS.map((link) => (
              <a
                key={link.id}
                className={`link-card lk-${link.id}`}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="lk-icon-chip" aria-hidden>
                  <img className="lk-logo" src={link.icon} alt="" loading="lazy" draggable={false} />
                </span>
                <span className="lk-copy">
                  <span className="link-card-name">{link.platform}</span>
                  {link.handle && <span className="link-card-handle">{link.handle}</span>}
                </span>
                <span className="lk-arrow" aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
