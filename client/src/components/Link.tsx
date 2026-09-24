import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { useRoute } from '../hooks/useRoute';

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** Real application path (e.g. `/profile/abc`). Never a `#/...` fragment. */
  to: string;
  children: ReactNode;
}

/**
 * SEO Fix 1 — crawlable internal link.
 *
 * Renders a real `<a href="/path">` so search crawlers see a normal link, while
 * same-origin left-clicks are handled by the History router (no full reload).
 * Modified clicks (new tab, etc.) fall through to the browser.
 */
export function Link({ to, children, onClick, ...rest }: LinkProps) {
  const { navigate } = useRoute();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };

  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
