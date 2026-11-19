import { useEffect, useState } from 'react';

import { api } from '../../api/client';
import { governanceHref } from '../../pages/governanceTabs';
import { useConsoleUi } from '../../stores/consoleUi';
import { useGovernanceFeatures } from '../../stores/governanceFeatures';
import { useSession } from '../../stores/session';
import { fieldClass as FIELD } from '../ui/form';

interface Member { user_id: string; email: string; full_name: string; role: string }

/** The organisation the console is working in: the user's own, or the scoped project's for a global admin. */
export function useWorkingOrgId(): string | null {
  const user = useSession((s) => s.user);
  const activeOrgId = useSession((s) => s.activeOrgId);
  return user?.tenant_id ?? activeOrgId ?? null;
}

/**
 * The model's named owner (a person), next to the owner team. Before, the team
 * was typed here and the person was set only on Governance › Accountability;
 * now both sit together and naming a person fills an unassigned team.
 */
export function NamedOwner({ modelId, onChanged }: { modelId: string; onChanged?: () => void }) {
  const enabled = useGovernanceFeatures((s) => s.features?.accountability);
  const orgId = useWorkingOrgId();
  const role = useSession((s) => s.user?.role ?? 'VIEWER');
  const toast = useConsoleUi((s) => s.toast);
  const [members, setMembers] = useState<Member[]>([]);
  const [owner, setOwner] = useState<Member | null | undefined>(undefined);
  const canSet = ['OWNER', 'CISO', 'ADMIN'].includes(role);

  useEffect(() => {
    if (!enabled || !orgId) return;
    let cancelled = false;
    Promise.all([
      api<{ members: Member[] }>(`/organizations/${orgId}/accountability`).catch(() => ({ members: [] as Member[] })),
      api<{ models: Array<{ model_id: string; owner: Member | null }> }>(`/organizations/${orgId}/owner-register`).catch(() => ({ models: [] })),
    ]).then(([acc, reg]) => {
      if (cancelled) return;
      setMembers(acc.members ?? []);
      setOwner(reg.models.find((m) => m.model_id === modelId)?.owner ?? null);
    });
    return () => { cancelled = true; };
  }, [enabled, orgId, modelId]);

  if (!enabled || !orgId || owner === undefined) return null;
  const save = async (userId: string) => {
    try {
      const r = await api<{ owner: Member | null }>(`/inventory/models/${modelId}/owner`, {
        method: 'PATCH', body: JSON.stringify({ owner_user_id: userId || null, reason: 'Set from the model popup' }),
      });
      setOwner(r.owner);
      toast(r.owner ? `Owner set to ${r.owner.full_name || r.owner.email}` : 'Named owner cleared', 'positive');
      onChanged?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Owner not saved', 'negative');
    }
  };
  return canSet ? (
    <select aria-label="Named owner" className={`${FIELD} mt-1`} value={owner?.user_id ?? ''} onChange={(e) => void save(e.target.value)}>
      <option value="">No named owner</option>
      {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email} · {m.role}</option>)}
    </select>
  ) : (
    <p className="mt-1 text-[10px] text-text-secondary">Named owner: {owner ? owner.full_name || owner.email : 'none'} <span className="text-text-tertiary">(an Owner or CISO sets it)</span></p>
  );
}

/** Approved AI policies (AIMS records), offered as the model's board policy reference. */
export function useApprovedPolicies(): string[] {
  return useAiPolicies().approved;
}

/** AI policies in the AIMS workspace: approved titles, and drafts waiting for approval. */
export function useAiPolicies(): { enabled: boolean; loaded: boolean; approved: string[]; drafts: string[] } {
  const enabled = Boolean(useGovernanceFeatures((s) => s.features?.aims));
  const [state, setState] = useState<{ loaded: boolean; approved: string[]; drafts: string[] }>({ loaded: false, approved: [], drafts: [] });
  useEffect(() => {
    if (!enabled) return;
    api<{ records: Array<{ type: string; status: string; title: string }> }>('/governance/aims/records?type=POLICY')
      .then((r) => {
        const pol = r.records.filter((x) => x.type === 'POLICY');
        setState({
          loaded: true,
          approved: pol.filter((x) => x.status === 'APPROVED').map((x) => x.title),
          drafts: pol.filter((x) => x.status === 'DRAFT').map((x) => x.title),
        });
      })
      .catch(() => setState({ loaded: true, approved: [], drafts: [] }));
  }, [enabled]);
  return { enabled, ...state };
}

/**
 * The board-approved AI policy a model operates under. With the AIMS workspace on, it is
 * chosen from the approved AI policies there; with none approved, it points to where to
 * create or approve one. A value already saved that is not an approved policy is kept as an
 * option, flagged, so opening the form never wipes it. With AIMS off it stays free text.
 */
export function PolicySelect({ value, onChange, placeholder, ariaLabel = 'Board policy reference' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string;
}) {
  const { enabled, loaded, approved, drafts } = useAiPolicies();
  const setDrawer = useConsoleUi((s) => s.setDrawer);
  if (!enabled) {
    return <input aria-label={ariaLabel} className={FIELD} placeholder={placeholder ?? 'e.g. AI-POL-2026-014'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" />;
  }
  const href = governanceHref('aims', null, { type: 'POLICY' });
  const link = (text: string) => <a href={href} onClick={() => setDrawer(false)} className="text-accent hover:underline">{text}</a>;
  const stale = Boolean(value) && !approved.includes(value);
  return (
    <>
      <select aria-label={ariaLabel} className={FIELD} value={value} disabled={loaded && approved.length === 0 && !value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{!loaded ? 'Loading AI policies…' : approved.length ? 'Choose an approved AI policy' : 'No approved AI policy yet'}</option>
        {approved.map((t) => <option key={t} value={t}>{t}</option>)}
        {stale && <option value={value}>{value} (not an approved AI policy)</option>}
      </select>
      {loaded && approved.length === 0 && (
        <p className="mt-0.5 text-[9.5px] text-warning">
          {drafts.length
            ? <>{drafts.join(', ')} {drafts.length === 1 ? 'is' : 'are'} still a draft. {link('Approve it in the AIMS workspace ↗')}</>
            : <>No AI policy in the AIMS workspace yet. {link('Create one ↗')}</>}
        </p>
      )}
      {loaded && approved.length > 0 && stale && (
        <p className="mt-0.5 text-[9.5px] text-warning">Not one of the approved AI policies in the AIMS workspace. Choose one above.</p>
      )}
    </>
  );
}

/** Link to the model's context profile, the one place intended use and oversight are kept. */
export function ContextProfileLink({ modelId }: { modelId: string }) {
  const enabled = useGovernanceFeatures((s) => s.features?.contextProfile);
  const setDrawer = useConsoleUi((s) => s.setDrawer);
  if (!enabled) return null;
  return (
    <a href={governanceHref('context', modelId)} onClick={() => setDrawer(false)} className="text-[9.5px] text-accent hover:underline">
      Intended users, limits and oversight pattern: context profile ↗
    </a>
  );
}
