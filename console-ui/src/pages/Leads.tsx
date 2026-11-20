import { CalendarClock, Inbox, Mail } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { AppShell } from '../components/console/AppShell';
import { Badge, BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PanelError } from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useConsoleUi } from '../stores/consoleUi';

export interface Lead {
  lead_id: string; kind: 'contact' | 'demo'; name: string; email: string; company: string | null; role: string | null;
  topic: string | null; message: string | null; slot_start: string | null; slot_minutes: number | null;
  visitor_timezone: string | null; status: string; admin_notes: string | null; handled_by: string | null;
  created_at: string; updated_at: string;
}
export interface LeadSummary { new_total: number; new_contacts: number; new_demos: number; upcoming_demos: number; next_demo: Lead | null; timezone: string }

const STATUS_TONE: Record<string, BadgeTone> = { NEW: 'negative', CONFIRMED: 'accent', CONTACTED: 'warning', DONE: 'positive', CANCELLED: 'neutral' };
const DEMO_STATUSES = ['NEW', 'CONFIRMED', 'DONE', 'CANCELLED'];
const CONTACT_STATUSES = ['NEW', 'CONTACTED', 'DONE'];

/** Tells the rail badge to refresh after a status change here. */
export const LEADS_CHANGED = 'sentrai:leads-changed';

function when(iso: string, tz?: string | null) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz ?? undefined, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/** Google Calendar link prefilled with the demo, so the admin can add it in one click. */
function gcalLink(l: Lead) {
  if (!l.slot_start) return '#';
  const s = new Date(l.slot_start);
  const e = new Date(s.getTime() + (l.slot_minutes ?? 30) * 60000);
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: `SentRAI demo · ${l.company ?? l.name}`,
    dates: `${f(s)}/${f(e)}`,
    details: `Demo for ${l.name}${l.role ? `, ${l.role}` : ''}${l.company ? ` at ${l.company}` : ''}.\n${l.message ?? ''}`,
    add: l.email,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/**
 * Platform admin inbox for the public landing page: demo bookings from the
 * calendar and messages from the contact form. New items show as a count on
 * the rail; each one can be confirmed, marked handled or cancelled, with notes.
 */
export function Leads() {
  const toast = useConsoleUi((s) => s.toast);
  const [kind, setKind] = useState<'all' | 'demo' | 'contact'>('all');
  const [rows, setRows] = useState<Lead[]>([]);
  const [summary, setSummary] = useState<LeadSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async (silent?: boolean) => {
    if (!silent) setLoading(true);
    try {
      const qs = kind === 'all' ? '' : `?kind=${kind}`;
      const [list, sum] = await Promise.all([api<Lead[]>(`/leads${qs}`), api<LeadSummary>('/leads/summary')]);
      setRows(Array.isArray(list) ? list : []);
      setSummary(sum);
      setError(null);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Failed to load leads');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [kind]);

  useEffect(() => { void load(); }, [load]);

  const update = async (l: Lead, body: { status?: string; admin_notes?: string }, msg: string) => {
    try {
      await api(`/leads/${l.lead_id}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast(msg, 'positive');
      window.dispatchEvent(new Event(LEADS_CHANGED));
      await load(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed', 'negative');
    }
  };

  const now = Date.now();
  const upcoming = rows.filter((r) => r.kind === 'demo' && r.slot_start && new Date(r.slot_start).getTime() >= now && ['NEW', 'CONFIRMED'].includes(r.status))
    .sort((a, b) => +new Date(a.slot_start!) - +new Date(b.slot_start!));
  const rest = rows.filter((r) => !upcoming.includes(r));

  const row = (l: Lead) => (
    <li key={l.lead_id} className={`px-3 py-2.5 ${l.status === 'NEW' ? 'bg-accent-soft/40' : ''}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={STATUS_TONE[l.status] ?? 'neutral'}>{l.status}</Badge>
        <Badge tone={l.kind === 'demo' ? 'accent' : 'neutral'}>{l.kind === 'demo' ? 'DEMO' : (l.topic ?? 'contact').toUpperCase()}</Badge>
        <span className="text-[12px] font-medium text-text">{l.name}</span>
        {l.role && <span className="text-[11px] text-text-secondary">· {l.role}</span>}
        {l.company && <span className="text-[11px] text-text-secondary">· {l.company}</span>}
        <a href={`mailto:${l.email}`} className="font-mono text-[10px] text-accent hover:underline">{l.email}</a>
        <span className="ml-auto font-mono text-[9px] text-text-tertiary">received {when(l.created_at)}</span>
      </div>
      {l.kind === 'demo' && l.slot_start && (
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text">
          <span className="flex items-center gap-1 font-medium"><CalendarClock size={12} className="text-accent" /> {when(l.slot_start, summary?.timezone)}</span>
          {l.visitor_timezone && l.visitor_timezone !== summary?.timezone && (
            <span className="font-mono text-[10px] text-text-tertiary">their time: {when(l.slot_start, l.visitor_timezone)}</span>
          )}
          <span className="font-mono text-[10px] text-text-tertiary">{l.slot_minutes ?? 30} min</span>
        </p>
      )}
      {l.message && <p className="mt-1 max-w-[100ch] whitespace-pre-line text-[11px] text-text-secondary">{l.message}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {l.kind === 'demo' && l.status === 'NEW' && <Button size="xs" variant="primary" onClick={() => update(l, { status: 'CONFIRMED' }, 'Demo confirmed')}>Confirm</Button>}
        {l.kind === 'demo' && l.slot_start && <a href={gcalLink(l)} target="_blank" rel="noopener noreferrer" className="rounded border border-border px-2 py-0.5 text-[10.5px] text-text-secondary hover:bg-surface-hover">Add to Google Calendar</a>}
        <a href={`mailto:${l.email}?subject=${encodeURIComponent(l.kind === 'demo' ? 'Your SentRAI demo' : 'Re: your SentRAI enquiry')}`} className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10.5px] text-text-secondary hover:bg-surface-hover"><Mail size={11} /> Reply</a>
        <select
          value={l.status}
          aria-label={`Status for ${l.name}`}
          onChange={(e) => update(l, { status: e.target.value }, `Marked ${e.target.value.toLowerCase()}`)}
          className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono text-[9.5px] text-text-secondary"
        >
          {(l.kind === 'demo' ? DEMO_STATUSES : CONTACT_STATUSES).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          className="min-w-[220px] flex-1 rounded border border-border bg-bg-elevated px-2 py-0.5 text-[10.5px] text-text placeholder:text-text-tertiary focus:border-accent"
          placeholder={l.admin_notes ?? 'Add a note (saved on Enter)'}
          value={notes[l.lead_id] ?? ''}
          onChange={(e) => setNotes({ ...notes, [l.lead_id]: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (notes[l.lead_id] ?? '').trim()) {
              void update(l, { admin_notes: notes[l.lead_id] }, 'Note saved');
              setNotes({ ...notes, [l.lead_id]: '' });
            }
          }}
        />
        {l.handled_by && <span className="font-mono text-[9px] text-text-tertiary">last handled by {l.handled_by}</span>}
      </div>
      {l.admin_notes && <p className="mt-1 font-mono text-[9.5px] text-text-tertiary">note: {l.admin_notes}</p>}
    </li>
  );

  return (
    <AppShell
      title="Leads"
      actions={
        <div className="flex rounded-md border border-border p-0.5">
          {(['all', 'demo', 'contact'] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)}
              className={`rounded px-2 py-0.5 text-[11px] ${kind === k ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface-hover'}`}>
              {k === 'all' ? 'All' : k === 'demo' ? 'Demo bookings' : 'Messages'}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
        <Kpi label="New" value={summary?.new_total ?? 0} tone={(summary?.new_total ?? 0) ? 'negative' : 'ok'} sub="not yet handled" />
        <Kpi label="New demo bookings" value={summary?.new_demos ?? 0} />
        <Kpi label="Upcoming demos" value={summary?.upcoming_demos ?? 0} sub={summary?.next_demo?.slot_start ? `next ${when(summary.next_demo.slot_start, summary.timezone)}` : 'none booked'} />
        <Kpi label="New messages" value={summary?.new_contacts ?? 0} />
      </div>
      <main className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        {error ? (
          <Panel title="Leads" className="flex-1"><PanelError onRetry={() => load()} /></Panel>
        ) : loading ? (
          <Panel title="Leads" className="flex-1"><SkeletonRows rows={6} /></Panel>
        ) : !rows.length ? (
          <Panel title="Leads" className="flex-1">
            <div className="flex h-full items-center justify-center p-6 text-center">
              <div>
                <Inbox size={20} className="mx-auto mb-2 text-text-tertiary" />
                <p className="text-[11px] text-text-secondary">No leads yet. Demo bookings and messages from the landing page land here.</p>
              </div>
            </div>
          </Panel>
        ) : (
          <>
            {upcoming.length > 0 && (
              <Panel title={`Upcoming demos · times in ${summary?.timezone ?? 'local time'}`} className="max-h-[45%] shrink-0">
                <ul className="divide-y divide-border">{upcoming.map(row)}</ul>
              </Panel>
            )}
            <Panel title={kind === 'contact' ? 'Messages' : kind === 'demo' ? 'Other demo bookings' : 'All leads'} className="flex-1">
              {rest.length ? <ul className="divide-y divide-border">{rest.map(row)}</ul> : <p className="p-4 text-[11px] text-text-secondary">Nothing else here.</p>}
            </Panel>
          </>
        )}
      </main>
    </AppShell>
  );
}

function Kpi({ label, value, tone, sub }: { label: string; value: number; tone?: 'ok' | 'warning' | 'negative'; sub?: string }) {
  const cls = tone === 'negative' ? 'text-negative' : tone === 'warning' ? 'text-warning' : tone === 'ok' ? 'text-positive' : 'text-text';
  return (
    <div className="bg-surface px-3 py-2">
      <div className="text-[9px] font-medium uppercase tracking-widest text-text-tertiary">{label}</div>
      <div className={`font-mono text-base leading-tight ${cls}`}>{value}</div>
      {sub && <div className="font-mono text-[8.5px] text-text-tertiary">{sub}</div>}
    </div>
  );
}
