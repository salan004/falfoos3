import { SOCIAL_LINKS } from '../data/socialLinks';

/**
 * Phase 12 — the owner's links page. Renders SOCIAL_LINKS from
 * data/socialLinks.ts; shows a calm empty state until real links are added.
 */
export function LinksPage() {
  return (
    <main className="page-fade">
      <div className="content-page">
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
              <a key={link.id} className="link-card" href={link.url} target="_blank" rel="noopener noreferrer">
                <span className="link-card-icon" aria-hidden>
                  {link.icon}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="link-card-name">{link.platform}</span>
                  <br />
                  {link.handle && <span className="link-card-handle">{link.handle}</span>}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
