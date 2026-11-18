/**
 * Impact assessment report layouts (E1.4): one record, several layouts
 * (ISO 42001, Australian DTA, OMB M-25-21, FTC-style system assessment,
 * EU FRIA). JSON sections, or Markdown for export.
 */
import { questionnaireById } from './questionnaires';

export const REPORT_LAYOUTS = [
  { id: 'iso', title: 'AI system impact assessment (ISO/IEC 42001)', questionnaires: ['iso-42001'] },
  { id: 'au', title: 'AI use case impact assessment (DTA policy v2.1)', questionnaires: ['au-dta', 'iso-42001'] },
  { id: 'm-25-21', title: 'High-impact AI assessment (OMB M-25-21)', questionnaires: ['us-m25-21', 'us-sr26-2', 'iso-42001'] },
  { id: 'ftc', title: 'Written AI system assessment (FTC Act s.5 expectations)', questionnaires: ['iso-42001'] },
  { id: 'eu-fria', title: 'Fundamental rights impact assessment (EU AI Act Art. 27)', questionnaires: ['eu-fria', 'iso-42001'] },
] as const;

export function renderReport(ia: Record<string, any>, layout: string, format: string, modelName: string) {
  const l = REPORT_LAYOUTS.find((x) => x.id === layout)!;
  const sections: Array<{ heading: string; items: Array<{ label: string; value: any; ref?: string }> }> = [];
  sections.push({
    heading: 'Record',
    items: [
      { label: 'Model', value: modelName },
      { label: 'Version', value: ia.version },
      { label: 'Status', value: ia.status },
      { label: 'Signed by', value: ia.signed_by ? `${ia.signed_by} (${ia.signed_by_role})` : 'not signed' },
      { label: 'Signed at', value: ia.signed_at ?? null },
      { label: 'Content hash', value: ia.content_hash ?? null },
      ...(ia.in_scope !== null ? [{ label: 'In scope', value: ia.in_scope }] : []),
      ...(ia.high_impact !== null ? [{ label: 'High impact', value: ia.high_impact }] : []),
      ...(ia.materiality ? [{ label: 'Materiality', value: ia.materiality }] : []),
    ],
  });
  const ctx = ia.context_snapshot?.profile;
  if (ctx) {
    sections.push({
      heading: 'Context',
      items: [
        { label: 'Intended users', value: ctx.intended_users },
        { label: 'Out-of-scope uses', value: ctx.out_of_scope_uses },
        { label: 'Known limitations', value: ctx.known_limitations },
        { label: 'Oversight pattern', value: ctx.oversight_pattern },
        { label: 'Cost of errors', value: ctx.cost_of_errors },
      ],
    });
  }
  for (const qid of l.questionnaires) {
    if (!ia.questionnaires.includes(qid)) continue;
    const q = questionnaireById(qid)!;
    const answers = ia.answers?.[qid] ?? {};
    sections.push({ heading: q.title, items: q.questions.map((x) => ({ label: x.text, value: answers[x.id] ?? null, ref: x.ref })) });
  }
  if (layout === 'ftc' || layout === 'iso' || layout === 'au' || layout === 'm-25-21') {
    sections.push({
      heading: 'Risks and residual ratings',
      items: (ia.risk_snapshot ?? []).map((r: any) => ({
        label: `${r.category}: ${r.title}`,
        value: r.assessment ? `residual ${r.assessment.residual.band} (${r.assessment.residual.score})${r.acceptance ? `, accepted by ${r.acceptance.accepted_by}` : r.within_appetite ? ', within appetite' : ', not accepted'}` : 'not assessed',
      })),
    });
  }
  const report = { layout: l.id, title: l.title, model: modelName, generated_at: new Date().toISOString(), sections };
  if (format !== 'md') return report;
  const fmt = (v: any) => (v === null || v === undefined || v === '' ? '_not answered_' : Array.isArray(v) ? (v.length ? v.join('; ') : '_none_') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
  const md = [`# ${l.title}`, '', `Model: **${modelName}**`, ''];
  for (const s of sections) {
    md.push(`## ${s.heading}`, '');
    for (const i of s.items) md.push(`- **${i.label}**${i.ref ? ` (${i.ref})` : ''}: ${fmt(i.value)}`);
    md.push('');
  }
  return { ...report, markdown: md.join('\n') };
}
