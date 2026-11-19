/**
 * Governance tabs, each shown only while its feature flag is on. Shared by the
 * Governance page and the help panel: the open tab is kept in the URL
 * (#/governance?tab=risks) so a tab can be linked to and "?" opens the help
 * for that tab.
 */
export type GovernanceTab = { id: string; label: string; flag: string };

export const GOVERNANCE_TABS: GovernanceTab[] = [
  { id: 'risks', label: 'Risk register', flag: 'riskRegister' },
  { id: 'impact', label: 'Impact assessments', flag: 'impactAssessment' },
  { id: 'context', label: 'Context profiles', flag: 'contextProfile' },
  { id: 'aims', label: 'AIMS workspace', flag: 'aims' },
  { id: 'actions', label: 'Corrective actions', flag: 'correctiveActions' },
  { id: 'documents', label: 'Documents', flag: 'documentControl' },
  { id: 'settings', label: 'Settings & risk appetite', flag: 'governanceSettings' },
  { id: 'accountability', label: 'Accountability', flag: 'accountability' },
  { id: 'history', label: 'Change history', flag: 'governanceSettings' },
  { id: 'au', label: 'Australia (DTA)', flag: 'auPack' },
  { id: 'decisions', label: 'Decisions & appeals', flag: 'usKit' },
  { id: 'validation', label: 'Model validation', flag: 'modelValidation' },
  { id: 'fairLending', label: 'Fair lending', flag: 'fairLending' },
  { id: 'vendors', label: 'Vendors & AI BOM', flag: 'vendors' },
  { id: 'training', label: 'Training', flag: 'training' },
  { id: 'datasets', label: 'Data register', flag: 'dataRegister' },
  { id: 'assurance', label: 'Red team & audit', flag: 'redTeamAuditRules' },
  { id: 'soa', label: 'Statement of Applicability', flag: 'soa' },
  { id: 'disclosures', label: 'Disclosures', flag: 'disclosures' },
  { id: 'incidentExt', label: 'Incident sign-off & ITSM', flag: 'incidentExtensions' },
  { id: 'tevv', label: 'TEVV & retirement', flag: 'tevv' },
  { id: 'energy', label: 'Energy', flag: 'energy' },
  { id: 'security', label: 'AI security', flag: 'aiSecurity' },
  { id: 'engagement', label: 'Engagement records', flag: 'orgRecords' },
  { id: 'federal', label: 'External AI & export', flag: 'federalVendor' },
];

/** The tab id in #/governance?tab=…, if it names a known tab. */
export function governanceTabFromHash(hash: string = window.location.hash): string | null {
  const q = hash.split('?')[1];
  if (!q) return null;
  const id = new URLSearchParams(q).get('tab');
  return id && GOVERNANCE_TABS.some((t) => t.id === id) ? id : null;
}

/** Record the open tab in the URL without a navigation (no hashchange, no history entry). */
export function setGovernanceTabInHash(id: string): void {
  if (!window.location.hash.replace(/^#\/?/, '').startsWith('governance')) return;
  window.history.replaceState(null, '', `#/governance?tab=${encodeURIComponent(id)}`);
}

/** Label of the open Governance tab, for the help panel. */
export function governanceTabLabel(hash: string = window.location.hash): string | null {
  const id = governanceTabFromHash(hash);
  return GOVERNANCE_TABS.find((t) => t.id === id)?.label ?? null;
}
