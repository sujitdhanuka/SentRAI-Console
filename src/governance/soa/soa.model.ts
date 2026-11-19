/**
 * ISO/IEC 42001:2023 Statement of Applicability (E3.1, clause 6.1.3 d).
 *
 * The 38 Annex A controls, each mapped to the library controls that evidence
 * it. The implementation status of an Annex A control is derived from the
 * results of those library controls across the organisation's AI systems;
 * where no library control evidences it, the organisation records the status
 * itself (shown as a manual status, never as a platform result).
 */
import { createHash } from 'crypto';

export interface AnnexAControl {
  ref: string;
  theme: string;
  title: string;
  /** Library controls whose results evidence this Annex A control (empty: manual status only). */
  controls: string[];
}

const T = {
  A2: 'A.2 Policies related to AI',
  A3: 'A.3 Internal organization',
  A4: 'A.4 Resources for AI systems',
  A5: 'A.5 Assessing impacts of AI systems',
  A6: 'A.6 AI system life cycle',
  A7: 'A.7 Data for AI systems',
  A8: 'A.8 Information for interested parties of AI systems',
  A9: 'A.9 Use of AI systems',
  A10: 'A.10 Third-party and customer relationships',
};

export const ANNEX_A: AnnexAControl[] = [
  { ref: 'A.2.2', theme: T.A2, title: 'AI policy', controls: ['CTL-ORG-POLICY'] },
  { ref: 'A.2.3', theme: T.A2, title: 'Alignment with other organizational policies', controls: ['CTL-ORG-POLICY'] },
  { ref: 'A.2.4', theme: T.A2, title: 'Review of the AI policy', controls: ['CTL-ORG-POLICY', 'CTL-ORG-FRAMEWORK-REVIEW'] },
  { ref: 'A.3.2', theme: T.A3, title: 'AI roles and responsibilities', controls: ['CTL-ACC-01', 'CTL-ORG-ACCOUNTABLE'] },
  { ref: 'A.3.3', theme: T.A3, title: 'Reporting of concerns', controls: [] },
  { ref: 'A.4.2', theme: T.A4, title: 'Resource documentation', controls: ['CTL-PROV-01', 'CTL-VENDOR-01'] },
  { ref: 'A.4.3', theme: T.A4, title: 'Data resources', controls: ['CTL-DATA-02'] },
  { ref: 'A.4.4', theme: T.A4, title: 'Tooling resources', controls: ['CTL-PROV-01'] },
  { ref: 'A.4.5', theme: T.A4, title: 'System and computing resources', controls: ['CTL-ENERGY-01'] },
  { ref: 'A.4.6', theme: T.A4, title: 'Human resources', controls: ['CTL-ORG-TRAINING', 'CTL-ORG-COMPETENCE'] },
  { ref: 'A.5.2', theme: T.A5, title: 'AI system impact assessment process', controls: ['CTL-IMPACT-01'] },
  { ref: 'A.5.3', theme: T.A5, title: 'Documentation of AI system impact assessments', controls: ['CTL-IMPACT-01'] },
  { ref: 'A.5.4', theme: T.A5, title: 'Assessing AI system impact on individuals or groups of individuals', controls: ['CTL-IMPACT-01', 'CTL-PRIV-01'] },
  { ref: 'A.5.5', theme: T.A5, title: 'Assessing societal impacts of AI systems', controls: ['CTL-IMPACT-01', 'CTL-ENERGY-01'] },
  { ref: 'A.6.1.2', theme: T.A6, title: 'Objectives for responsible development of AI system', controls: ['CTL-ORG-OBJECTIVES'] },
  { ref: 'A.6.1.3', theme: T.A6, title: 'Processes for responsible AI system design and development', controls: ['CTL-RISK-02', 'CTL-TEVV-01'] },
  { ref: 'A.6.2.2', theme: T.A6, title: 'AI system requirements and specification', controls: ['CTL-CTX-01', 'CTL-CTX-03'] },
  { ref: 'A.6.2.3', theme: T.A6, title: 'Documentation of AI system design and development', controls: ['CTL-DOC-01'] },
  { ref: 'A.6.2.4', theme: T.A6, title: 'AI system verification and validation', controls: ['CTL-VAL-01', 'CTL-TEVV-01'] },
  { ref: 'A.6.2.5', theme: T.A6, title: 'AI system deployment', controls: ['CTL-DEP-01'] },
  { ref: 'A.6.2.6', theme: T.A6, title: 'AI system operation and monitoring', controls: ['CTL-MON-01', 'CTL-SEC-AI-01'] },
  { ref: 'A.6.2.7', theme: T.A6, title: 'AI system technical documentation', controls: ['CTL-DOC-02'] },
  { ref: 'A.6.2.8', theme: T.A6, title: 'AI system recording of event logs', controls: ['CTL-REC-01'] },
  { ref: 'A.7.2', theme: T.A7, title: 'Data for development and enhancement of AI system', controls: ['CTL-DATA-01', 'CTL-DATA-02'] },
  { ref: 'A.7.3', theme: T.A7, title: 'Acquisition of data', controls: ['CTL-DATA-02'] },
  { ref: 'A.7.4', theme: T.A7, title: 'Quality of data for AI systems', controls: ['CTL-DATA-01', 'CTL-DATA-02'] },
  { ref: 'A.7.5', theme: T.A7, title: 'Data provenance', controls: ['CTL-PROV-01', 'CTL-DATA-02'] },
  { ref: 'A.7.6', theme: T.A7, title: 'Data preparation', controls: ['CTL-DATA-02'] },
  { ref: 'A.8.2', theme: T.A8, title: 'System documentation and information for users', controls: ['CTL-CTX-03', 'CTL-INFO-01'] },
  { ref: 'A.8.3', theme: T.A8, title: 'External reporting', controls: [] },
  { ref: 'A.8.4', theme: T.A8, title: 'Communication of incidents', controls: ['CTL-INC-01', 'CTL-INC-02'] },
  { ref: 'A.8.5', theme: T.A8, title: 'Information for interested parties', controls: ['CTL-ORG-DISCLOSURE'] },
  { ref: 'A.9.2', theme: T.A9, title: 'Processes for responsible use of AI systems', controls: ['CTL-HUM-01'] },
  { ref: 'A.9.3', theme: T.A9, title: 'Objectives for responsible use of AI system', controls: ['CTL-ORG-OBJECTIVES'] },
  { ref: 'A.9.4', theme: T.A9, title: 'Intended use of the AI system', controls: ['CTL-CTX-01'] },
  { ref: 'A.10.2', theme: T.A10, title: 'Allocating responsibilities', controls: ['CTL-VENDOR-01'] },
  { ref: 'A.10.3', theme: T.A10, title: 'Suppliers', controls: ['CTL-VENDOR-01'] },
  { ref: 'A.10.4', theme: T.A10, title: 'Customers', controls: ['CTL-INFO-01', 'CTL-DEPLOYER-01'] },
];

export type SoaStatus = 'IMPLEMENTED' | 'PARTIAL' | 'NOT_IMPLEMENTED' | 'NOT_ASSESSED' | 'NOT_APPLICABLE';
/** Statuses an organisation may record for a control the platform cannot evidence. */
export const MANUAL_STATUSES = ['IMPLEMENTED', 'PARTIAL', 'NOT_IMPLEMENTED', 'PLANNED'] as const;

/** One library control's results across the organisation (MODEL controls: one per system; ORG: one). */
export interface ControlTally {
  pass: number;
  fail: number;
  notAssessed: number;
}

/**
 * Derived status: every assessed result passes → IMPLEMENTED; some pass →
 * PARTIAL; none pass → NOT_IMPLEMENTED; nothing assessed → NOT_ASSESSED.
 * A control that is not assessed never counts as a pass.
 */
export function deriveStatus(tallies: Array<ControlTally | undefined>): { status: SoaStatus; pass: number; fail: number; notAssessed: number } {
  const t = tallies.filter((x): x is ControlTally => Boolean(x));
  const pass = t.reduce((a, x) => a + x.pass, 0);
  const fail = t.reduce((a, x) => a + x.fail, 0);
  const notAssessed = t.reduce((a, x) => a + x.notAssessed, 0);
  if (pass + fail === 0) return { status: 'NOT_ASSESSED', pass, fail, notAssessed };
  if (fail === 0) return { status: 'IMPLEMENTED', pass, fail, notAssessed };
  return { status: pass > 0 ? 'PARTIAL' : 'NOT_IMPLEMENTED', pass, fail, notAssessed };
}

export interface SoaEntryInput {
  included: boolean;
  justification: string | null;
  manualStatus: string | null;
  manualNote: string | null;
}

export interface SoaRow {
  ref: string;
  theme: string;
  title: string;
  included: boolean;
  justification: string;
  justification_source: 'ORGANISATION' | 'DEFAULT';
  status: SoaStatus | string;
  status_source: 'CONTROLS' | 'MANUAL' | 'NONE';
  evidence: { controls: string[]; pass: number; fail: number; not_assessed: number };
  manual_note: string | null;
}

/** Default inclusion justification (ISO 6.1.3 asks for one for every control, included or not). */
export function defaultJustification(c: AnnexAControl): string {
  return `Included: needed to treat AI risks identified in the risk assessment (${c.title.toLowerCase()}).`;
}

/** Build the SoA rows from the Annex A list, the organisation's entries and the control tallies. */
export function buildSoa(entries: Map<string, SoaEntryInput>, tallies: Map<string, ControlTally>): SoaRow[] {
  return ANNEX_A.map((c) => {
    const e = entries.get(c.ref);
    const included = e ? e.included : true;
    const derived = deriveStatus(c.controls.map((id) => tallies.get(id)));
    let status: SoaRow['status'] = derived.status;
    let source: SoaRow['status_source'] = c.controls.length ? 'CONTROLS' : 'NONE';
    if (!included) {
      status = 'NOT_APPLICABLE';
    } else if (derived.status === 'NOT_ASSESSED' && e?.manualStatus) {
      // A recorded status only fills a gap the platform cannot evidence; it never overrides a platform result.
      status = e.manualStatus;
      source = 'MANUAL';
    }
    return {
      ref: c.ref,
      theme: c.theme,
      title: c.title,
      included,
      justification: e?.justification ?? (included ? defaultJustification(c) : ''),
      justification_source: e?.justification ? 'ORGANISATION' : 'DEFAULT',
      status,
      status_source: source,
      evidence: { controls: c.controls, pass: derived.pass, fail: derived.fail, not_assessed: derived.notAssessed },
      manual_note: e?.manualNote ?? null,
    };
  });
}

/** Problems that stop approval: an exclusion without a justification. */
export function approvalProblems(rows: SoaRow[]): string[] {
  return rows.filter((r) => !r.included && !r.justification.trim()).map((r) => `${r.ref} is excluded without a justification`);
}

export function soaSummary(rows: SoaRow[]) {
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return {
    controls: rows.length,
    included: rows.filter((r) => r.included).length,
    excluded: rows.filter((r) => !r.included).length,
    implemented: count('IMPLEMENTED'),
    partial: count('PARTIAL'),
    not_implemented: count('NOT_IMPLEMENTED'),
    not_assessed: count('NOT_ASSESSED'),
    manual: rows.filter((r) => r.status_source === 'MANUAL').length,
  };
}

/** Hash of what an approval freezes: the rows' inclusion, justification and status. */
export function soaHash(rows: SoaRow[]): string {
  const canon = rows.map((r) => [r.ref, r.included, r.justification, r.status, r.status_source]);
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}
