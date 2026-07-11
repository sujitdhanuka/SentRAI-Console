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
  validateEuAiAct,
  validateIso42001,
  validateNistRmf,
} from './frameworks.validator';

export function generateCompliancePdf(entry: AIModelEntry): Promise<Buffer> {
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
        const status = c.passed ? 'PASS' : 'FAIL';
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(c.passed ? '#166534' : '#991b1b')
          .text(`[${status}] ${c.controlCode} — ${c.name}`);
        if (c.evidence) {
          doc.font('Helvetica').fontSize(8).fillColor('#475569').text(c.evidence, { indent: 12 });
        }
      }
    };

    const nist = validateNistRmf(entry);
    const eu = validateEuAiAct(entry);
    const iso = validateIso42001(entry);

    section('NIST AI RMF 1.0 Compliance Checklist', nist);
    section('EU AI Act Compliance Checklist', eu, `Assessed Risk Tier: ${eu.riskTier}`);
    section('ISO 42001 Compliance Checklist', iso);

    doc.end();
  });
}
