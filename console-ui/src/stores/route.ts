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
  'audit',
  'incidents',
  'lineage',
  'ai-settings',
  'ai-usage',
  'users',
  'orgs',
  'docs',
] as const;

export type Route = (typeof ROUTES)[number];

const parse = (): Route => {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return (ROUTES as readonly string[]).includes(raw) ? (raw as Route) : 'projects';
};

export function navigate(route: Route): void {
  window.location.hash = `#/${route}`;
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
