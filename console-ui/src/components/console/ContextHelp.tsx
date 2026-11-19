import { marked } from 'marked';
import { BookOpen, CircleHelp, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '../../api/client';
import { navigate, Route, useRoute } from '../../stores/route';
import { governanceTabLabel } from '../../pages/governanceTabs';

/**
 * Which HELP.md section belongs to each screen. public/docs/HELP.md stays the
 * single source of truth for the wording — this only decides which slice of it
 * to show, so help text never drifts from the guide.
 */
const HELP_SECTIONS: Record<Route, string> = {
  projects: 'Projects',
  inventory: 'Model Inventory',
  compliance: 'Compliance Rollup',
  alignment: 'Alignment',
  'ci-ledger': 'CI Gate Ledger',
  monitoring: 'Drift Monitoring',
  visibility: 'Runtime Visibility',
  audit: 'Audit Trail',
  incidents: 'Incidents',
  grievances: 'Consumer Grievances',
  lineage: 'Lineage Graph',
  'ai-settings': 'AI Settings',
  'ai-usage': 'LLM Usage',
  users: 'Users',
  orgs: 'Organizations',
  docs: 'Docs',
  governance: 'Governance',
};

let docsCache: string | null = null;

async function getDocs(): Promise<string> {
  if (docsCache != null) return docsCache;
  const data = await api<{ content?: string }>('/docs');
  docsCache = data?.content ?? '';
  return docsCache;
}

/**
 * Slice one "### N. Title" section (heading plus body, up to the next ## or ###)
 * out of the guide.
 */
export function extractHelpSection(md: string, title: string): string | null {
  const lines = md.split('\n');
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^###\\s+\\d+\\.\\s*${esc}\\s*$`, 'i');
  const start = lines.findIndex((l) => re.test(l.trim()));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^###?\s+\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

/**
 * Narrow a screen's section to one of its "#### Sub title" parts: the section's
 * introduction (everything before the first ####) plus that part. Returns the
 * whole section when the part is not found.
 */
export function narrowHelpSection(section: string, sub: string | null): string {
  if (!sub) return section;
  const lines = section.split('\n');
  const isSub = (l: string) => /^####\s+\S/.test(l);
  const target = (l: string) => isSub(l) && l.replace(/^####\s+/, '').trim().toLowerCase() === sub.trim().toLowerCase();
  const start = lines.findIndex(target);
  if (start === -1) return section;
  const firstSub = lines.findIndex(isSub);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isSub(lines[i])) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, firstSub), ...lines.slice(start, end)].join('\n').trim();
}

/**
 * Context-sensitive help: the header button and the "?" key open the guide
 * section for whatever screen you are on, without leaving it.
 */
export function ContextHelp() {
  const route = useRoute();
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const title = HELP_SECTIONS[route];
  // On Governance, "?" opens the help for the tab you are on.
  const [sub, setSub] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const tab = route === 'governance' ? governanceTabLabel() : null;
    setSub(tab);
    setLoading(true);
    getDocs()
      .then((md) => {
        const whole = title ? extractHelpSection(md, title) : null;
        const section = whole ? narrowHelpSection(whole, tab) : null;
        setHtml(
          section
            ? (marked.parse(section, { async: false }) as string)
            : '<p>No screen-specific help here yet — open the full guide for details.</p>',
        );
      })
      .catch((e) => setHtml(`<p>Couldn't load help — ${e instanceof Error ? e.message : 'unknown error'}.</p>`))
      .finally(() => setLoading(false));
  }, [open, title, route]);

  // "?" opens help, Escape closes it — but never while the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key !== '?') return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || el?.isContentEditable) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`Help for this screen (?)`}
        aria-label="Help for this screen"
        className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-surface-hover"
      >
        <CircleHelp size={13} />
      </button>

      {open && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Help for ${sub ? `${title}: ${sub}` : title}`}
        >
          <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-md border border-border-strong bg-surface">
            <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
              <CircleHelp size={13} className="text-accent" />
              <h2 className="font-heading text-[12px] font-medium text-text">
                Help <span className="text-text-tertiary">·</span> {title}
                {sub && (
                  <>
                    {' '}
                    <span className="text-text-tertiary">·</span> {sub}
                  </>
                )}
              </h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close help"
                className="ml-auto flex h-6 w-6 items-center justify-center rounded text-text-tertiary hover:bg-surface-hover hover:text-text"
              >
                <X size={13} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {loading ? (
                <p className="text-[11px] text-text-secondary">Loading help…</p>
              ) : (
                <div className="docs-body" dangerouslySetInnerHTML={{ __html: html }} />
              )}
            </div>

            <footer className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2">
              <span className="font-mono text-[9px] text-text-tertiary">press ? anywhere · Esc to close</span>
              <button
                onClick={() => {
                  setOpen(false);
                  navigate('docs');
                }}
                className="ml-auto flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[10.5px] text-text-secondary hover:bg-surface-hover"
              >
                <BookOpen size={11} /> Open full guide
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
