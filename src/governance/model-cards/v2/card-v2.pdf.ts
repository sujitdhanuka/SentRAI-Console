/**
 * Model card v2 PDF (spec §12), generated from the same catalogue as the
 * screen. `cardPdfLines` builds the content as plain lines (tested by
 * snapshot); `generateCardV2Pdf` draws them with pdfkit. Anything that is not
 * an approved version carries a DRAFT watermark on every page, and every page
 * ends with the fixed disclaimer.
 */
import PDFDocument from 'pdfkit';

export const PDF_DISCLAIMER = 'This model card documents the system. Framework mappings are not evidence of compliance or certification.';

const PROVENANCE_MARK: Record<string, string> = {
  HUMAN_ENTERED: 'entered by a person',
  AI_SUGGESTED: 'AI SUGGESTION, not accepted',
  CODE_SCAN: 'CODE SCAN, not accepted',
  INTEGRATION: 'from an integration',
  IMPORTED_V1: 'imported from v1',
};

export interface PdfMeta {
  version: number | null;
  kind: 'APPROVED' | 'SNAPSHOT' | 'LIVE';
  content_hash: string;
  generated_by: string;
  generated_at: string;
}

export type PdfLine =
  | { k: 'title'; text: string }
  | { k: 'h'; text: string }
  | { k: 'kv'; label: string; text: string }
  | { k: 'p'; text: string }
  | { k: 'small'; text: string };

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map((x) => (x && typeof x === 'object' ? Object.values(x).filter((y) => y !== null && y !== '').join(' / ') : String(x))).join('; ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** The PDF content as lines. `card` is the card view (live, or a frozen version's content). */
export function cardPdfLines(card: any, meta: PdfMeta): PdfLine[] {
  const L: PdfLine[] = [];
  const status = meta.kind === 'APPROVED' ? `APPROVED v${meta.version}` : meta.kind === 'SNAPSHOT' ? `DRAFT snapshot v${meta.version}` : 'DRAFT (live)';
  L.push({ k: 'title', text: `Model card: ${card.model_name}` });
  L.push({ k: 'h', text: 'Document control' });
  L.push({ k: 'kv', label: 'Status', text: status });
  L.push({ k: 'kv', label: 'Workflow state', text: show(card.record?.workflow_state) });
  L.push({ k: 'kv', label: 'Content hash (SHA-256)', text: meta.content_hash });
  L.push({ k: 'kv', label: 'Generated', text: `${meta.generated_at} by ${meta.generated_by}` });
  L.push({ k: 'kv', label: 'Catalogue version', text: show(card.catalogue_version) });
  L.push({ k: 'p', text: PDF_DISCLAIMER });

  const s = card.summary ?? {};
  L.push({ k: 'h', text: 'Summary' });
  L.push({ k: 'kv', label: 'Record type', text: `${show(s.record_type)}${s.record_type_accepted ? '' : ' (not yet accepted by a person)'}` });
  for (const [k, v] of Object.entries(s.states ?? {})) L.push({ k: 'kv', label: k.replace(/_/g, ' '), text: show(v) });
  L.push({ k: 'kv', label: 'Internal risk tier', text: `inherent ${show(s.inherent_risk_tier)}, residual ${show(s.residual_risk_tier)} (${show(s.risk_status)})` });
  L.push({ k: 'kv', label: 'Regulatory classification', text: `EU AI Act ${show(s.regulatory_classification?.eu)}; Korea high-impact ${show(s.regulatory_classification?.kr_high_impact)} (set separately from the internal tier)` });
  L.push({ k: 'kv', label: 'Next review', text: `${show(card.record?.next_review_at)} (${show(card.record?.review_status)})` });

  L.push({ k: 'h', text: 'Scores (four separate measures, never combined)' });
  for (const x of card.scores ?? []) {
    L.push({ k: 'kv', label: x.title, text: `${x.numerator} / ${x.denominator}${x.percent === null ? '' : ` (${x.percent}%)`}` });
    L.push({ k: 'small', text: `How: ${x.how}` });
  }

  const blockers = card.gate?.blockers ?? [];
  L.push({ k: 'h', text: blockers.length ? `Blocking a final card (${blockers.length})` : 'Finalisation gate: no blockers' });
  for (const b of blockers) L.push({ k: 'small', text: `• ${b.message}` });

  const risk = card.risk;
  if (risk) {
    L.push({ k: 'h', text: 'Risk engine explanation' });
    L.push({ k: 'kv', label: 'Score', text: `${risk.score} of ${risk.max_score}; score tier ${risk.score_tier}; with floors ${risk.computed_inherent_tier}` });
    for (const c of risk.contributions ?? []) L.push({ k: 'small', text: `• ${c.label}: ${show(c.value)} → ${c.points}/${c.max_points}${c.note ? ` (${c.note})` : ''}` });
    for (const f of risk.floors ?? []) L.push({ k: 'small', text: `• Floor ${f.tier}: ${f.reason}` });
    for (const f of risk.findings ?? []) L.push({ k: 'small', text: `• ${f.blocking ? 'Blocking' : 'Note'}${f.hard_rule ? ` (hard rule ${f.hard_rule})` : ''}: ${f.message}` });
  }

  L.push({ k: 'h', text: 'Framework mapping' });
  for (const f of (card.frameworks ?? []).filter((x: any) => x.applies !== 'DOES_NOT_APPLY')) {
    L.push({ k: 'kv', label: f.short_title, text: `${f.label}. ${f.heading}. Registry revision ${f.revision}, ${f.verification_status}.` });
    for (const c of f.controls ?? []) L.push({ k: 'small', text: `• ${c.control_id} ${c.title}: ${c.status}${c.in_force === 'NOT_YET_IN_FORCE' ? ` (applies from ${c.effective_from}, not yet in force)` : c.in_force === 'DATE_UNKNOWN' ? ' (date to be confirmed)' : ''}` });
  }

  for (const sec of (card.sections ?? []).filter((x: any) => x.applicable)) {
    const fields = sec.fields.filter((f: any) => f.applicable && (f.effective !== 'NOT_REQUIRED' || (f.value && f.value.status !== 'NOT_ASSESSED')));
    if (!fields.length) continue;
    L.push({ k: 'h', text: `${sec.number}. ${sec.title} (${sec.completion.numerator}/${sec.completion.denominator} required complete)` });
    for (const f of fields) {
      const v = f.value ?? {};
      const marks = [f.effective === 'MANDATORY' ? 'required' : 'recommended', v.status, v.provenance ? PROVENANCE_MARK[v.provenance] ?? v.provenance : null, v.provenance && v.provenance !== 'HUMAN_ENTERED' && !v.accepted_by ? 'awaiting acceptance' : null]
        .filter(Boolean).join(' · ');
      const value = f.sensitive && v.value ? '(sensitive: not printed)' : v.status === 'NOT_APPLICABLE' ? `N/A: ${v.na_justification ?? '(no justification)'} (decided by ${v.na_decided_by ?? '?'})` : show(v.value);
      L.push({ k: 'kv', label: f.label, text: `${value}  [${marks}]` });
      if (v.suggestion) L.push({ k: 'small', text: `AI or scan suggestion (not accepted): ${show(v.suggestion.value).slice(0, 600)}` });
      if (v.evidence_refs?.length) L.push({ k: 'small', text: `Evidence: ${v.evidence_refs.map((e: any) => `${e.type} ${e.ref}`).join('; ')}${v.verified_by ? `; verified by ${v.verified_by}` : ''}` });
      if (f.framework_control_refs?.length) L.push({ k: 'small', text: `Framework refs: ${f.framework_control_refs.join(', ')}` });
    }
  }

  L.push({ k: 'h', text: 'Approval history' });
  const approvals = card.approvals ?? [];
  if (!approvals.length) L.push({ k: 'small', text: 'No approvals recorded.' });
  for (const a of approvals) {
    L.push({ k: 'small', text: `• ${a.decided_at} ${a.step} ${a.decision} by ${a.decided_by} (${a.decided_role})${a.superseded ? ', superseded' : ''}${a.comment ? `: ${a.comment}` : ''}` });
    for (const c of a.conditions ?? []) L.push({ k: 'small', text: `   condition: ${c.text} (owner ${c.owner}, due ${c.due})` });
  }
  return L;
}

/** The PDF. Pass `fixedDate` in tests so the output does not depend on the clock. */
export function generateCardV2Pdf(card: any, meta: PdfMeta, fixedDate?: Date): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margins: { top: 48, bottom: 60, left: 48, right: 48 }, bufferPages: true,
      info: { Title: `Model card: ${card.model_name}`, Creator: 'SentrAI model card v2', CreationDate: fixedDate ?? new Date(meta.generated_at) },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (b: Buffer) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 96;
    const ensure = (h: number) => { if (doc.y + h > doc.page.height - 70) doc.addPage(); };

    for (const l of cardPdfLines(card, meta)) {
      if (l.k === 'title') { doc.font('Helvetica-Bold').fontSize(17).fillColor('#0f172a').text(l.text, { width: W }); doc.moveDown(0.4); }
      else if (l.k === 'h') { ensure(40); doc.moveDown(0.5); doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(l.text, { width: W }); doc.moveDown(0.2); }
      else if (l.k === 'kv') {
        ensure(20);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#334155').text(l.label, 48, y, { width: 150 });
        const yl = doc.y;
        doc.font('Helvetica').fontSize(8.5).fillColor('#0f172a').text(l.text, 206, y, { width: W - 158 });
        doc.y = Math.max(yl, doc.y) + 2;
      } else if (l.k === 'p') { ensure(30); doc.font('Helvetica-Oblique').fontSize(9).fillColor('#a4620f').text(l.text, 48, doc.y, { width: W }); doc.moveDown(0.3); }
      else { ensure(14); doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text(l.text, 56, doc.y, { width: W - 8 }); }
    }

    // Watermark and footer on every page.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      if (meta.kind !== 'APPROVED') {
        doc.save();
        doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
        doc.font('Helvetica-Bold').fontSize(110).fillColor('#dc2626').fillOpacity(0.12)
          .text('DRAFT', 0, doc.page.height / 2 - 60, { width: doc.page.width, align: 'center', lineBreak: false });
        doc.restore();
        doc.fillOpacity(1);
      }
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7).fillColor('#64748b')
        .text(`${PDF_DISCLAIMER}  ·  ${card.model_name}  ·  ${meta.kind === 'APPROVED' ? `approved v${meta.version}` : 'DRAFT'}  ·  page ${i + 1} of ${range.count}`, 48, doc.page.height - 40, { width: W, align: 'center', lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
