/**
 * PDF blocks shared by the portfolio readiness PDF and the board report: the
 * frameworks in scope, reviewed coverage, governance capabilities, register
 * counts and model cards, and the scope-aware footer.
 */
import type PDFKit from 'pdfkit';

import { GovernanceProgramme } from './governance-programme';

const SUB = '#334155';
const MUT = '#64748b';
const GOOD = '#166534';
const WARN = '#a4620f';

type Doc = PDFKit.PDFDocument;

export function frameworksInScopeBlock(doc: Doc, g: GovernanceProgramme, size = 9.5): void {
  doc.font('Helvetica').fontSize(size).fillColor(SUB)
    .text(`In scope: ${g.packs_in_scope.map((p) => `${p.name} v${p.version}${p.baseline ? ' (baseline)' : p.region ? ` (${p.region})` : ''}`).join('; ') || 'none'}.`);
  if (g.packs_off.length) {
    doc.moveDown(0.15).fillColor(MUT)
      .text(`Switched off in Governance › Setup, so not assessed or counted: ${g.packs_off.map((p) => p.name).join('; ')}.`);
  }
}

export function coverageBlock(doc: Doc, g: GovernanceProgramme, size = 9): void {
  if (!g.coverage.length) {
    doc.font('Helvetica').fontSize(size).fillColor(MUT).text('No reviewed coverage for the frameworks in scope.');
    return;
  }
  for (const c of g.coverage) {
    const impl = c.implemented !== null && c.applicable
      ? ` Reviewed implementation: ${c.implemented} of ${c.applicable} applicable requirements implemented, ${c.partial} partial, ${c.gap} gap.`
      : '';
    doc.moveDown(0.15).font('Helvetica-Bold').fontSize(size).fillColor(SUB).text(`${c.framework}: `, { continued: true })
      .font('Helvetica').text(`${c.controls_evaluated} automated checks per model (regime: ${c.universe_total} ${c.universe_unit}).${impl}`);
  }
}

export function capabilitiesBlock(doc: Doc, g: GovernanceProgramme, size = 9): void {
  if (!g.governance_on) {
    doc.font('Helvetica').fontSize(size).fillColor(MUT).text('The governance capabilities are switched off in this deployment (GOVERNANCE_V2).');
    return;
  }
  for (const c of g.capabilities) {
    doc.moveDown(0.15).font('Helvetica-Bold').fontSize(size).fillColor(SUB).text(`${c.group}: `, { continued: true })
      .font('Helvetica').fillColor(c.on.length ? SUB : MUT).text(`${c.on.length}/${c.on.length + c.off.length} on${c.on.length ? ` (${c.on.join(', ')})` : ''}${c.off.length && c.on.length ? `; off: ${c.off.join(', ')}` : ''}.`);
  }
}

export function registersBlock(doc: Doc, g: GovernanceProgramme, size = 9): void {
  const r = g.registers;
  if (!r) {
    doc.font('Helvetica').fontSize(size).fillColor(MUT).text('Governance registers are not in use in this scope.');
    return;
  }
  const lines: string[] = [];
  if (r.risks_total !== null) lines.push(`Risk register: ${r.risks_total} risk(s), ${r.risks_open} needing attention.`);
  if (r.impact_final_models !== null) lines.push(`Impact assessments: ${r.impact_final_models} model(s) with a final assessment, ${r.impact_draft} draft(s), ${r.impact_revalidation} awaiting revalidation.`);
  if (r.actions_open !== null) lines.push(`Corrective actions: ${r.actions_open} open, ${r.actions_overdue} overdue.`);
  if (r.documents_approved !== null) lines.push(`Controlled documents: ${r.documents_approved} approved, ${r.documents_review_due} past their review date.`);
  if (r.soa_version !== null) lines.push(`Statement of Applicability: ${r.soa_version}.`);
  if (r.vendors_active !== null) lines.push(`Vendors: ${r.vendors_active} active.`);
  doc.font('Helvetica').fontSize(size).fillColor(SUB);
  for (const l of lines) doc.moveDown(0.15).text(l);
}

export function modelCardsBlock(doc: Doc, g: GovernanceProgramme, size = 9): void {
  const m = g.model_cards;
  if (!m) {
    doc.font('Helvetica').fontSize(size).fillColor(MUT).text('Model cards are switched off in this deployment.');
    return;
  }
  doc.font('Helvetica').fontSize(size).fillColor(m.final_current === m.models && m.models > 0 ? GOOD : SUB)
    .text(`${m.final_current} of ${m.models} model(s) have a current final model card; ${m.final_stale} final card(s) are stale after a model change; ${m.draft_only} have a draft only; ${m.none} have none.`);
  if (m.final_stale) doc.moveDown(0.15).fillColor(WARN).text('Stale cards need a new version from the model page (Model card tab).');
}

export function scopeFooter(g: GovernanceProgramme | null | undefined, what: string): string {
  const names = g?.packs_in_scope.map((p) => p.name) ?? [];
  const scope = names.length
    ? `This report assesses the frameworks enabled for the organisation: ${names.join('; ')}.`
    : 'This report assesses RBI FREE-AI, the US NIST AI RMF, the EU AI Act and ISO/IEC 42001.';
  return `SentRAI ${g?.version ?? ''} · ${scope} ${what} It supports oversight and does not by itself constitute regulatory certification.`.replace(/ {2,}/g, ' ');
}
