import { useEffect, useState } from 'react';

/**
 * Hash routing (#/projects) — deliberately, not history routing: the console is
 * served as static files by NestJS, and hashes need no server-side rewrite for
 * deep links to work.
 */
export const ROUTES = [
  'projects',
  'inventory',
  'compliance',
  'alignment',
  'ci-ledger',
  'monitoring',
  'visibility',
  'audit',
  'incidents',
  'grievances',
  'lineage',
  'ai-settings',
  'ai-usage',
  'users',
  'orgs',
  'docs',
  'governance',
  'model',
  'workflows',
  'leads',
] as const;

export type Route = (typeof ROUTES)[number];

const parse = (): Route => {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return (ROUTES as readonly string[]).includes(raw) ? (raw as Route) : 'projects';
};

/** Go to a page, optionally with query parameters (#/audit?model=…). */
export function navigate(route: Route, query?: string | Record<string, string>): void {
  const q = typeof query === 'string' ? query : query ? new URLSearchParams(query).toString() : '';
  window.location.hash = `#/${route}${q ? `?${q}` : ''}`;
}

/** A query parameter of the current hash route (#/page?name=value). */
export function routeParam(name: string, hash: string = window.location.hash): string | null {
  const q = hash.split('?')[1];
  return q ? new URLSearchParams(q).get(name) : null;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener('hashchange', onHash);
    if (!window.location.hash) window.location.replace('#/projects');
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
