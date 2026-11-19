import { useCallback, useEffect, useState } from 'react';

/**
 * Governance tabs, each shown only while its feature flag is on, grouped into
 * sections so the page shows a short row of sections and then the tabs of the
 * open section. Shared by the Governance page and the help panel: the open tab
 * is kept in the URL (#/governance?tab=risks) so a tab can be linked to and
 * "?" opens the help for that tab.
 */
export type GovernanceGroupId = 'setup' | 'risk' | 'aims' | 'data' | 'operations' | 'transparency';
export type GovernanceGroup = { id: GovernanceGroupId; label: string; hint: string };
export type GovernanceTab = { id: string; label: string; flag: string; group: GovernanceGroupId };

/** Sections, in the order they are shown. */
export const GOVERNANCE_GROUPS: GovernanceGroup[] = [
  { id: 'setup', label: 'Setup', hint: 'Risk appetite, frameworks, who is accountable and what changed' },
  { id: 'risk', label: 'Risk & impact', hint: 'Risks, impact assessments, validation, fairness and decisions' },
  { id: 'aims', label: 'ISO management system', hint: 'ISO/IEC 42001 AIMS, actions, controlled documents, SoA and training' },
  { id: 'data', label: 'Data & suppliers', hint: 'Datasets, vendors and the AI bill of materials, external AI' },
  { id: 'operations', label: 'Operations & assurance', hint: 'Red team, audit, TEVV, security and energy' },
  { id: 'transparency', label: 'Transparency & regional', hint: 'Public disclosures, engagement records and country packs' },
];

export const GOVERNANCE_TABS: GovernanceTab[] = [
  // Setup
  { id: 'settings', label: 'Settings & risk appetite', flag: 'governanceSettings', group: 'setup' },
  { id: 'accountability', label: 'Accountability', flag: 'accountability', group: 'setup' },
  { id: 'context', label: 'Context profiles', flag: 'contextProfile', group: 'setup' },
  { id: 'history', label: 'Change history', flag: 'governanceSettings', group: 'setup' },
  // Risk & impact
  { id: 'risks', label: 'Risk register', flag: 'riskRegister', group: 'risk' },
  { id: 'impact', label: 'Impact assessments', flag: 'impactAssessment', group: 'risk' },
  { id: 'validation', label: 'Model validation', flag: 'modelValidation', group: 'risk' },
  { id: 'fairLending', label: 'Fair lending', flag: 'fairLending', group: 'risk' },
  { id: 'decisions', label: 'Decisions & appeals', flag: 'usKit', group: 'risk' },
  // ISO management system
  { id: 'aims', label: 'AIMS workspace', flag: 'aims', group: 'aims' },
  { id: 'actions', label: 'Corrective actions', flag: 'correctiveActions', group: 'aims' },
  { id: 'documents', label: 'Documents', flag: 'documentControl', group: 'aims' },
  { id: 'soa', label: 'Statement of Applicability', flag: 'soa', group: 'aims' },
  { id: 'training', label: 'Training', flag: 'training', group: 'aims' },
  // Data & suppliers
  { id: 'datasets', label: 'Data register', flag: 'dataRegister', group: 'data' },
  { id: 'vendors', label: 'Vendors & AI BOM', flag: 'vendors', group: 'data' },
  { id: 'federal', label: 'External AI & export', flag: 'federalVendor', group: 'data' },
  // Operations & assurance
  { id: 'assurance', label: 'Red team & audit', flag: 'redTeamAuditRules', group: 'operations' },
  { id: 'tevv', label: 'TEVV & retirement', flag: 'tevv', group: 'operations' },
  { id: 'security', label: 'AI security', flag: 'aiSecurity', group: 'operations' },
  { id: 'energy', label: 'Energy', flag: 'energy', group: 'operations' },
  // Transparency & regional
  { id: 'disclosures', label: 'Disclosures', flag: 'disclosures', group: 'transparency' },
  { id: 'engagement', label: 'Engagement records', flag: 'orgRecords', group: 'transparency' },
  { id: 'au', label: 'Australia (DTA)', flag: 'auPack', group: 'transparency' },
  { id: 'eu', label: 'EU AI Act', flag: 'euAiAct', group: 'transparency' },
];

/** The tab opened when the URL names none: the risk register, the most used. */
export const DEFAULT_GOVERNANCE_TAB = 'risks';

/** The tab id in #/governance?tab=…, if it names a known tab. */
export function governanceTabFromHash(hash: string = window.location.hash): string | null {
  const q = hash.split('?')[1];
  if (!q) return null;
  const id = new URLSearchParams(q).get('tab');
  return id && GOVERNANCE_TABS.some((t) => t.id === id) ? id : null;
}

/** Query parameters of the governance hash route. */
function governanceQuery(hash: string = window.location.hash): URLSearchParams {
  return new URLSearchParams(hash.split('?')[1] ?? '');
}

/** Rewrite the governance hash's query without a navigation (no hashchange, no history entry). */
function replaceGovernanceQuery(edit: (q: URLSearchParams) => void): void {
  if (!window.location.hash.replace(/^#\/?/, '').startsWith('governance')) return;
  const q = governanceQuery();
  edit(q);
  window.history.replaceState(null, '', `#/governance?${q.toString()}`);
}

/** Record the open tab in the URL. The chosen model stays, so it carries across tabs. */
export function setGovernanceTabInHash(id: string): void {
  replaceGovernanceQuery((q) => {
    q.set('tab', id);
    q.delete('risk');
  });
}

/** The model chosen on the Governance page (#/governance?tab=…&model=…), if any. */
export function governanceModelFromHash(hash: string = window.location.hash): string {
  return governanceQuery(hash).get('model') ?? fixedModelFromHash(hash) ?? '';
}

/** On the model page (#/model?id=…) the Governance tabs shown there work on that one model. */
export function fixedModelFromHash(hash: string = window.location.hash): string | null {
  return /^#\/?model(\?|$)/.test(hash) ? new URLSearchParams(hash.split('?')[1] ?? '').get('id') : null;
}

/** The model a tab is fixed to (on the model page), or null on the Governance page; pickers hide when fixed. */
export function useFixedModel(): string | null {
  return fixedModelFromHash();
}

/**
 * The model the Governance tabs work on. Every per-model tab reads and writes
 * the same value in the URL, so choosing a model once carries across tabs and
 * a link (from the model popup or elsewhere) opens a tab on that model.
 */
export function useGovernanceModel(): [string, (id: string) => void] {
  const [id, setId] = useState(() => governanceModelFromHash());
  useEffect(() => {
    const onHash = () => setId(governanceModelFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const set = useCallback((next: string) => {
    if (fixedModelFromHash()) return; // the model page shows one model
    setId(next);
    replaceGovernanceQuery((q) => (next ? q.set('model', next) : q.delete('model')));
  }, []);
  return [id, set];
}

/** Link to a Governance tab, optionally on one model: #/governance?tab=risks&model=… */
export function governanceHref(tab: string, modelId?: string | null, extra?: Record<string, string>): string {
  const q = new URLSearchParams({ tab, ...(modelId ? { model: modelId } : {}), ...(extra ?? {}) });
  return `#/governance?${q.toString()}`;
}

/** Label of the open Governance tab, for the help panel. */
export function governanceTabLabel(hash: string = window.location.hash): string | null {
  const id = governanceTabFromHash(hash);
  return GOVERNANCE_TABS.find((t) => t.id === id)?.label ?? null;
}

/** Label of the section holding the open Governance tab, for the help panel. */
export function governanceGroupLabel(hash: string = window.location.hash): string | null {
  const id = governanceTabFromHash(hash);
  const group = GOVERNANCE_TABS.find((t) => t.id === id)?.group;
  return GOVERNANCE_GROUPS.find((g) => g.id === group)?.label ?? null;
}
