/**
 * Framework-as-data (Roadmap Pillar 5 — Societal, disclosure). Regulatory
 * regimes and their disclosure / incident-reporting obligations expressed as
 * DATA, not code: onboarding a new jurisdiction (MAS, UK, …) is a config entry,
 * not a code change. Surfaced on the public model card so a consumer sees which
 * regimes govern a system and how fast harms must be reported.
 */
export interface Regime {
  id: string;
  name: string;
  jurisdiction: string;
  authority: string;
  /** Hours within which a serious AI incident must be reported (null = n/a). */
  incidentReportHours: number | null;
  disclosureObligations: string[];
  consumerRedress: boolean;
  reference: string;
  status: 'operational' | 'reference';
}

export const REGIMES: Regime[] = [
  {
    id: 'rbi_free_ai', name: 'RBI FREE-AI', jurisdiction: 'India', authority: 'Reserve Bank of India',
    incidentReportHours: 24,
    disclosureObligations: ['Board-approved AI policy', 'Consumer disclosure of AI use', 'Grievance redress mechanism', 'CERT-In incident reporting (6h severe)'],
    consumerRedress: true, reference: 'RBI FREE-AI Committee Report (2025)', status: 'operational',
  },
  {
    id: 'eu_ai_act', name: 'EU AI Act', jurisdiction: 'European Union', authority: 'European Commission / national authorities',
    // Art. 73(2): 15 days for a serious incident (2 days for widespread infringement, 10 for a death).
    incidentReportHours: 360,
    disclosureObligations: ['Transparency to affected persons', 'High-risk system registration', 'Serious-incident reporting', 'Human-oversight disclosure'],
    consumerRedress: true, reference: 'Regulation (EU) 2024/1689', status: 'operational',
  },
  {
    id: 'nist_ai_rmf', name: 'NIST AI RMF', jurisdiction: 'United States', authority: 'NIST (voluntary)',
    incidentReportHours: null,
    disclosureObligations: ['Documented risk management', 'Measurement & monitoring', 'Governance function'],
    consumerRedress: false, reference: 'NIST AI RMF 1.0', status: 'operational',
  },
  {
    id: 'iso_42001', name: 'ISO/IEC 42001', jurisdiction: 'International', authority: 'ISO (certification)',
    incidentReportHours: null,
    disclosureObligations: ['AI management system', 'Continual improvement', 'Interested-party needs'],
    consumerRedress: false, reference: 'ISO/IEC 42001:2023', status: 'operational',
  },
  {
    id: 'mas_singapore', name: 'MAS FEAT', jurisdiction: 'Singapore', authority: 'Monetary Authority of Singapore',
    incidentReportHours: null,
    disclosureObligations: ['Fairness, Ethics, Accountability, Transparency', 'Consumer notification of AIDA use'],
    consumerRedress: true, reference: 'MAS FEAT Principles', status: 'reference',
  },
  {
    id: 'uk_dsit', name: 'UK Pro-Innovation AI', jurisdiction: 'United Kingdom', authority: 'DSIT / sector regulators',
    incidentReportHours: null,
    disclosureObligations: ['Safety, security, robustness', 'Transparency & explainability', 'Contestability & redress'],
    consumerRedress: true, reference: 'UK AI Regulation White Paper', status: 'reference',
  },
];

/** The operational regimes SentRAI evaluates today (vs. reference-only). */
export function operationalRegimes(): Regime[] {
  return REGIMES.filter((r) => r.status === 'operational');
}
