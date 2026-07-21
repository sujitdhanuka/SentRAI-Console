import { marked } from 'marked';
import { useEffect, useMemo, useState } from 'react';

import { api } from '../api/client';
import { AppShell } from '../components/console/AppShell';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonBlock } from '../components/ui/Skeleton';

/** Renders HELP.md (served by the API) as the in-console user guide. */
export function Docs() {
  const [md, setMd] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api<{ content: string; error?: string }>('/docs')
      .then((r) => (r.error ? setError(r.error) : setMd(r.content)))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load docs'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const html = useMemo(() => {
    if (!md) return '';
    const raw = marked.parse(md, { async: false }) as string;
    // marked v18 drops heading ids; re-add them so the contents links resolve.
    return raw.replace(/<h2>(.*?)<\/h2>/g, (_m, t: string) => {
      const id = t.replace(/<[^>]+>/g, '').toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
      return `<h2 id="${id}">${t}</h2>`;
    });
  }, [md]);

  // Section anchors for the sidebar, taken from the '## ' headings.
  const sections = useMemo(
    () => md.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.replace(/^##\s+/, '')),
    [md],
  );
  const slug = (s: string) => s.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

  return (
    <AppShell title="Docs">
      <main className="flex min-h-0 flex-1 gap-2 p-2">
        <Panel title="Contents" className="hidden w-[240px] shrink-0 lg:flex">
          <ul className="p-2">
            {sections.map((s) => (
              <li key={s}>
                <a
                  href={`#${slug(s)}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(slug(s))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="block rounded px-2 py-1 text-[10.5px] text-text-secondary hover:bg-surface-hover hover:text-text"
                >
                  {s}
                </a>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="User guide" className="flex-1">
          {error ? (
            <PanelError onRetry={load} />
          ) : loading ? (
            <SkeletonBlock />
          ) : (
            <div className="docs-body px-4 py-3" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </Panel>
      </main>
    </AppShell>
  );
}
