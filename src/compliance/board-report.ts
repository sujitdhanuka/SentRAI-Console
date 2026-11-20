import PDFDocument from 'pdfkit';

import { GovernanceProgramme } from './governance-programme';
import { capabilitiesBlock, coverageBlock, frameworksInScopeBlock, modelCardsBlock, registersBlock, scopeFooter } from './report-sections';

/**
 * The board pack: a multi-section governance report a board or risk committee
 * reads in one sitting. Aggregates every governance surface the platform tracks
 * — framework readiness, risk posture, the shift-left CI gate, runtime scope
 * enforcement, incidents, consumer redress, and audit-ledger integrity — into a
 * single circulation-ready PDF. Distinct from the one-page portfolio readiness
 * export: this is the periodic board deliverable, not the operational snapshot.
 */
export interface BoardReportPayload {
  generated_at: string;
  org_name: string;
  scope_name: string;
  narrative: string | null;
  summary: {
    total_models: number;
    fully_compliant: number;
    compliance_rate: number;
    high_risk_models: number;
    open_blocking_gaps: number;
    headline: string;
  };
  risk_tiers: Record<string, number>;
  frameworks: Array<{ name: string; models_passing: number; models_assessed: number; pass_rate: number; open_gaps: number; readiness: string }>;
  top_gaps: Array<{ framework: string; control: string; count: number; statement: string }>;
  gate: { total: number; failed: number; blocked_now: number; overridden: number };
  runtime: { flagged_tool_calls: number; scope_deviation_models: number };
  incidents: { total: number; open: number; by_severity: Record<string, number> };
  grievances: { total: number; open: number; resolved: number };
  audit: { chained_events: number; intact: boolean };
  /** Frameworks whose packs are switched off for every model in scope. */
  frameworks_not_in_scope?: string[];
  /** Governance programme: packs, capabilities, coverage, registers and model cards. */
  governance?: GovernanceProgramme;
}

const INK = '#0f172a';
const SUB = '#334155';
const MUT = '#64748b';
const GOOD = '#166534';
const BAD = '#991b1b';
const RULE = '#e2e8f0';
const SIG = '#2240c9';

export function generateBoardReportPdf(p: BoardReportPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 54, left: 54, right: 54 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 108; // content width
    const rule = () => {
      doc.moveDown(0.35);
      const y = doc.y;
      doc.strokeColor(RULE).lineWidth(1).moveTo(54, y).lineTo(54 + W, y).stroke();
      doc.moveDown(0.45);
    };
    const h = (t: string) => {
      doc.moveDown(0.7).font('Helvetica-Bold').fontSize(13).fillColor(INK).text(t);
      doc.moveDown(0.15);
    };
    const kv = (pairs: Array<[string, string]>) => {
      doc.font('Helvetica').fontSize(9.5).fillColor(SUB);
      doc.text(pairs.map(([k, v]) => `${k}:  ${v}`).join('        '));
    };

    // ── Cover band ──────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 132).fill('#0f172a');
    doc.fillColor('#e5e9f7').font('Helvetica-Bold').fontSize(11).text('SENTRAI · AI GOVERNANCE', 54, 40, { characterSpacing: 1.5 });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(24).text('Board Governance Report', 54, 62);
    doc.fillColor('#aeb9dd').font('Helvetica').fontSize(10).text(`${p.org_name} · ${p.scope_name}`, 54, 98);
    doc.fillColor(MUT).font('Helvetica').fontSize(8.5).text(`Generated ${new Date(p.generated_at).toUTCString()}${p.governance ? ` · SentRAI ${p.governance.version}` : ''}`, 54, 146);
    doc.moveDown(1.4);

    // ── Executive summary + AI-drafted narrative ────────────────────────────
    h('Executive Summary');
    doc.font('Helvetica').fontSize(10).fillColor(SUB).text(p.summary.headline);
    if (p.narrative) {
      doc.moveDown(0.4).font('Helvetica-Oblique').fontSize(9.5).fillColor('#475569').text(p.narrative, { align: 'left' });
    }
    doc.moveDown(0.5);
    kv([
      ['Models in scope', String(p.summary.total_models)],
      ['No blocking gaps (field checks)', `${p.summary.fully_compliant} (${Math.round(p.summary.compliance_rate * 100)}%)`],
      ['High-risk', String(p.summary.high_risk_models)],
      ['Open blocking gaps', String(p.summary.open_blocking_gaps)],
    ]);
    rule();

    // ── Frameworks in scope (enabled packs) ─────────────────────────────────
    if (p.governance) {
      h('Frameworks in Scope');
      frameworksInScopeBlock(doc, p.governance);
      rule();
    }

    // ── Framework readiness ─────────────────────────────────────────────────
    h('Regulatory Framework Readiness');
    if (!p.frameworks.length) doc.font('Helvetica').fontSize(9.5).fillColor(MUT).text('No framework assessed in this scope.');
    for (const f of p.frameworks) {
      const ok = f.open_gaps === 0 && f.models_assessed > 0;
      doc.moveDown(0.2).font('Helvetica-Bold').fontSize(10).fillColor(ok ? GOOD : BAD)
        .text(`${f.name}`, { continued: true })
        .font('Helvetica').fillColor(MUT).text(`   ${f.models_passing}/${f.models_assessed} models · ${Math.round(f.pass_rate * 100)}%${ok ? '' : ` · ${f.open_gaps} gaps`}`);
      doc.font('Helvetica').fontSize(8.5).fillColor(SUB).text(f.readiness, { indent: 12 });
    }
    doc.moveDown(0.3);
    kv([['Risk tiers', Object.entries(p.risk_tiers).map(([k, v]) => `${k} ${v}`).join('   ') || 'none']]);
    rule();

    // ── Controls in force (the enforcement story) ───────────────────────────
    h('Controls In Force');
    doc.font('Helvetica').fontSize(9.5).fillColor(SUB);
    doc.text(`Shift-left CI gate:  ${p.gate.total} pipeline decision(s), ${p.gate.failed} blocked at build, ${p.gate.blocked_now} blocking now, ${p.gate.overridden} auditor-overridden.`);
    doc.moveDown(0.2).text(`Runtime tool authorization:  ${p.runtime.flagged_tool_calls} unauthorized tool call(s) flagged across ${p.runtime.scope_deviation_models} model(s) breaching sanctioned scope.`);
    doc.moveDown(0.2).text(`Audit ledger:  ${p.audit.chained_events} hash-chained event(s); integrity ${p.audit.intact ? 'verified intact' : 'BROKEN — investigate'}.`);
    rule();

    // ── Governance programme ────────────────────────────────────────────────
    if (p.governance) {
      h('Governance Programme');
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text('Capabilities in force');
      capabilitiesBlock(doc, p.governance);
      doc.moveDown(0.4).font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text('Registers');
      registersBlock(doc, p.governance);
      doc.moveDown(0.4).font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text('Coverage of the frameworks in scope (reviewed assessment)');
      coverageBlock(doc, p.governance);
      rule();

      h('Model Documentation');
      modelCardsBlock(doc, p.governance, 9.5);
      rule();
    }

    // ── Incidents & consumer redress ────────────────────────────────────────
    h('Incidents & Consumer Redress');
    doc.font('Helvetica').fontSize(9.5).fillColor(SUB);
    const sev = Object.entries(p.incidents.by_severity).map(([k, v]) => `${k} ${v}`).join('   ') || 'none';
    doc.text(`Incidents:  ${p.incidents.total} total, ${p.incidents.open} open  (${sev}).`);
    doc.moveDown(0.2).text(`Consumer grievances:  ${p.grievances.total} filed, ${p.grievances.open} open, ${p.grievances.resolved} resolved — each under a severity-based SLA.`);
    rule();

    // ── Most common blocking gaps ───────────────────────────────────────────
    h('Priority Remediation — Most Common Blocking Gaps');
    if (p.top_gaps.length === 0) {
      doc.font('Helvetica').fontSize(9.5).fillColor(GOOD).text('No blocking gaps across the portfolio.');
    } else {
      for (const g of p.top_gaps.slice(0, 8)) {
        doc.moveDown(0.15).font('Helvetica-Bold').fontSize(9).fillColor(SIG)
          .text(`[${g.framework} · ${g.control}]`, { continued: true })
          .font('Helvetica').fillColor(SUB).text(`  ${g.statement}  (${g.count} model${g.count === 1 ? '' : 's'})`);
      }
    }

    doc.moveDown(1.2).font('Helvetica').fontSize(7.5).fillColor('#94a3b8').text(
      p.governance
        ? scopeFooter(p.governance, 'It is generated from registered-model metadata, the governance registers and observed evidence (CI gates, runtime telemetry, incidents, grievances and the append-only audit ledger).')
        : 'SentRAI operationalizes RBI FREE-AI, the US NIST AI RMF, the EU AI Act, and ISO/IEC 42001. This report is generated from registered-model metadata and observed evidence (CI gates, runtime telemetry, incidents, grievances, and the append-only audit ledger). It supports board oversight and does not by itself constitute regulatory certification.',
      54,
    );

    doc.end();
  });
}
