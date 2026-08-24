import { useCallback, useEffect, useState } from 'react';

function readPath(): string {
  const raw = window.location.hash.replace(/^#/, '');
  const path = raw.startsWith('/') ? raw : '/' + raw;
  return path === '/' ? '/' : path.replace(/\/+$/, '');
}

export function useHashRoute() {
  const [path, setPath] = useState<string>(readPath);

  useEffect(() => {
    const onChange = () => setPath(readPath());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((to: string) => {
    const next = to.startsWith('/') ? to : '/' + to;
    if (readPath() === next) return;
    window.location.hash = '#' + next;
  }, []);

  return { path, navigate };
}

export function matchGameRoute(path: string): { gameId: string } | null {
  const m = path.match(/^\/game\/([a-z_]+)$/i);
  return m ? { gameId: m[1] } : null;
}
