/**
 * Compliance PDF report generator (pdfkit). Reproduces the NIST/EU/ISO
 * checklist report from src/sentrai/compliance/pdf_generator.py. Flag emoji are
 * replaced with text labels to avoid font-embedding issues with pdfkit's
 * standard Helvetica.
 */
import PDFDocument from 'pdfkit';

import { AIModelEntry } from '../domain/model-inventory';
import {
  FrameworkComplianceReport,
  ValidationContext,
  validateEuAiAct,
  validateIso42001,
  validateNistRmf,
} from './frameworks.validator';

export function generateCompliancePdf(entry: AIModelEntry, ctx: ValidationContext = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 40, bottom: 40, left: 40, right: 40 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(24).fillColor('#1e293b').text('SentrAI Compliance Report');
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(10).fillColor('#334155').text(`Model ID: ${entry.modelId}`);
    doc.text(`Model Name: ${entry.name}`);
    doc.moveDown(0.8);

    const section = (title: string, report: FrameworkComplianceReport, subtitle?: string) => {
      doc.moveDown(0.6).font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text(title);
      if (subtitle) doc.font('Helvetica').fontSize(10).fillColor('#334155').text(subtitle);
      doc.moveDown(0.2);
      for (const c of report.checks) {
        const status = c.notAssessed ? 'NOT ASSESSED' : c.passed ? 'PASS' : 'FAIL';
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(c.notAssessed ? '#475569' : c.passed ? '#166534' : '#991b1b')
          .text(`[${status}] ${c.controlCode} — ${c.name}`);
        if (c.evidence) {
          doc.font('Helvetica').fontSize(8).fillColor('#475569').text(c.evidence, { indent: 12 });
        }
      }
    };

    const nist = validateNistRmf(entry, ctx);
    const eu = validateEuAiAct(entry, ctx);
    const iso = validateIso42001(entry, ctx);

    section('NIST AI RMF 1.0 Compliance Checklist', nist);
    section('EU AI Act Compliance Checklist', eu, `Assessed Risk Tier: ${eu.riskTier}`);
    section('ISO 42001 Compliance Checklist', iso);

    doc.end();
  });
}

/**
 * Portfolio-level framework readiness report — an executive rollup across all
 * models, not a single model. Renders the aggregate summary, per-framework
 * readiness, risk-tier distribution, and the most common blocking gaps.
 */
export function generatePortfolioPdf(report: {
  generated_at: string;
  summary: { total_models: number; fully_compliant: number; compliance_rate: number; high_risk_models: number; open_blocking_gaps: number; headline: string };
  risk_tiers: Record<string, number>;
  frameworks: Array<{ name: string; models_assessed: number; models_passing: number; pass_rate: number; open_gaps: number; readiness: string }>;
  top_gaps: Array<{ framework: string; control: string; count: number; statement: string }>;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 40, bottom: 40, left: 40, right: 40 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(22).fillColor('#1e293b').text('AI Governance — Portfolio Readiness');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(`Generated ${new Date(report.generated_at).toUTCString()}`);
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text('Executive Summary');
    doc.moveDown(0.2).font('Helvetica').fontSize(10).fillColor('#334155').text(report.summary.headline);
    doc.moveDown(0.3);
    const s = report.summary;
    doc.fontSize(9).fillColor('#475569').text(
      `Total models: ${s.total_models}    Fully compliant: ${s.fully_compliant} (${Math.round(s.compliance_rate * 100)}%)    ` +
        `High-risk: ${s.high_risk_models}    Open blocking gaps: ${s.open_blocking_gaps}`,
    );

    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text('Framework Readiness');
    for (const f of report.frameworks) {
      const ok = f.open_gaps === 0 && f.models_assessed > 0;
      doc.moveDown(0.25).font('Helvetica-Bold').fontSize(10).fillColor(ok ? '#166534' : '#991b1b').text(f.name);
      doc.font('Helvetica').fontSize(9).fillColor('#334155').text(f.readiness, { indent: 10 });
    }

    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text('Risk-Tier Distribution');
    const tiers = Object.entries(report.risk_tiers).map(([k, v]) => `${k}: ${v}`).join('    ') || 'none';
    doc.moveDown(0.2).font('Helvetica').fontSize(9).fillColor('#334155').text(tiers);

    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text('Most Common Blocking Gaps');
    if (report.top_gaps.length === 0) {
      doc.moveDown(0.2).font('Helvetica').fontSize(9).fillColor('#166534').text('No blocking gaps across the portfolio.');
    } else {
      for (const g of report.top_gaps) {
        doc.moveDown(0.15).font('Helvetica').fontSize(9).fillColor('#334155').text(`• [${g.framework} · ${g.control}] ${g.statement}`);
      }
    }

    doc.moveDown(1).font('Helvetica').fontSize(7).fillColor('#94a3b8').text(
      'SentrAI operationalizes RBI FREE-AI, NIST AI RMF, the EU AI Act, and ISO/IEC 42001. This report reflects registered-model metadata and observed evidence; it does not by itself constitute regulatory certification.',
    );

    doc.end();
  });
}
