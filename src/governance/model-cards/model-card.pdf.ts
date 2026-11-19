/**
 * Model card PDF (governance E4.1). Plain Helvetica, no images, A4: a header
 * band with the status (DRAFT or FINAL), the readiness line, then one block
 * per section with its framework mapping and a two-column field table.
 */
import PDFDocument from 'pdfkit';

import { mdBlocks, MdRun } from '../../common/markdown-lite';
import { CardContent, CardExportMeta, showCardValue } from './model-card.model';

const INK = '#0f172a';
const SUB = '#334155';
const MUT = '#64748b';
const RULE = '#e2e8f0';
const SIG = '#2240c9';
const WARN = '#a4620f';
const GOOD = '#166534';

const fontOf = (r: MdRun) => (r.code ? 'Courier' : r.bold && r.italic ? 'Helvetica-BoldOblique' : r.bold ? 'Helvetica-Bold' : r.italic ? 'Helvetica-Oblique' : 'Helvetica');

/**
 * Writes a free-text value at (x, y) within width, rendering its Markdown
 * (paragraphs, headings, lists, bold, italic, code) instead of showing the
 * raw asterisks. Leaves doc.y below the text.
 */
export function writeMarkdown(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number, size: number, color: string): void {
  const blocks = mdBlocks(text);
  doc.y = y;
  blocks.forEach((b, i) => {
    if (i > 0) doc.y += size * (b.kind === 'li' && blocks[i - 1].kind === 'li' ? 0.15 : 0.55);
    const indent = b.kind === 'li' ? 10 * (b.level ?? 1) + (b.marker!.length > 1 ? 4 : 0) : 0;
    const fs = b.kind === 'h' ? size + Math.max(0, 3 - (b.level ?? 1)) : size;
    const runs = b.kind === 'h' ? b.runs.map((r) => ({ ...r, bold: true })) : b.runs;
    const top = doc.y;
    if (b.kind === 'li') doc.font('Helvetica').fontSize(fs).fillColor(color).text(b.marker!, x + indent - (b.marker!.length > 1 ? 14 : 8), top, { lineBreak: false });
    if (!runs.length) return;
    runs.forEach((r, j) => {
      doc.font(fontOf(r)).fontSize(r.code ? fs - 0.5 : fs).fillColor(color);
      const opts = { width: width - indent, continued: j < runs.length - 1 };
      if (j === 0) doc.text(r.text, x + indent, top, opts);
      else doc.text(r.text, opts);
    });
  });
}

export function generateModelCardPdf(c: CardContent, meta: CardExportMeta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 48, right: 48 } });
    const chunks: Buffer[] = [];
    doc.on('data', (b: Buffer) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 96;
    const final = meta.status === 'FINAL';

    doc.rect(0, 0, doc.page.width, 112).fill(INK);
    doc.fillColor('#e5e9f7').font('Helvetica-Bold').fontSize(9.5).text('SENTRAI · MODEL CARD', 48, 34, { characterSpacing: 1.5 });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text(c.model_name, 48, 52, { width: W - 120 });
    doc.fillColor('#aeb9dd').font('Helvetica').fontSize(9).text([c.organisation, c.project].filter(Boolean).join(' · ') || ' ', 48, 84);
    const badge = final ? `FINAL v${meta.version}` : meta.version ? `DRAFT v${meta.version}` : 'DRAFT (live)';
    doc.roundedRect(48 + W - 110, 50, 110, 22, 3).fill(final ? GOOD : WARN);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text(badge, 48 + W - 110, 56, { width: 110, align: 'center' });

    doc.y = 126;
    doc.x = 48;
    doc.fillColor(MUT).font('Helvetica').fontSize(8)
      .text(`Generated ${new Date(meta.generated_at).toUTCString()}${meta.created_by ? ` by ${meta.created_by}` : ''} · content hash ${meta.content_hash.slice(0, 16)}`);
    doc.text(`Frameworks in scope: ${c.packs_in_scope.map((p) => `${p.name} v${p.version}`).join('; ') || '—'}`);
    if (meta.readiness) {
      doc.moveDown(0.3).font('Helvetica-Bold').fontSize(9).fillColor(SUB)
        .text(`Readiness ${meta.readiness.percent}%  ·  ${meta.readiness.required_met}/${meta.readiness.required_total} required  ·  ${meta.readiness.recommended_met}/${meta.readiness.recommended_total} recommended`);
    }
    if (!final) {
      doc.moveDown(0.4).font('Helvetica-Bold').fontSize(8.5).fillColor(WARN)
        .text('DRAFT: not a final model card. It has not passed the required-field and gate checks for a final version.');
    }
    if (meta.stale) {
      doc.moveDown(0.3).font('Helvetica-Bold').fontSize(8.5).fillColor('#991b1b')
        .text(`STALE: the model has changed since this version was frozen (${(meta.changed_sections ?? []).join(', ')}).`);
    }

    for (const s of c.sections) {
      if (doc.y > doc.page.height - 140) doc.addPage();
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(12).fillColor(INK).text(s.title, 48);
      if (s.frameworks.length) {
        doc.font('Helvetica').fontSize(7.5).fillColor(SIG).text(`Maps to: ${s.frameworks.map((f) => `${f.pack_name} ${f.clauses.join(', ')}`).join('  ·  ')}`, { width: W });
      }
      doc.moveDown(0.2);
      const y0 = doc.y;
      doc.strokeColor(RULE).lineWidth(0.8).moveTo(48, y0).lineTo(48 + W, y0).stroke();
      for (const f of s.fields) {
        if (doc.y > doc.page.height - 70) doc.addPage();
        const y = doc.y + 3;
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(f.required && !f.filled ? '#991b1b' : SUB).text(`${f.label}${f.required ? ' *' : ''}`, 48, y, { width: 150 });
        const h1 = doc.y;
        if (typeof f.value === 'string' && f.filled) writeMarkdown(doc, f.value, 210, y, W - 162, 8.5, SUB);
        else doc.font('Helvetica').fontSize(8.5).fillColor(f.filled ? SUB : MUT).text(showCardValue(f.value), 210, y, { width: W - 162 });
        doc.y = Math.max(h1, doc.y) + 2;
        doc.strokeColor(RULE).lineWidth(0.5).moveTo(48, doc.y).lineTo(48 + W, doc.y).stroke();
      }
    }
    doc.moveDown(1).font('Helvetica').fontSize(7).fillColor('#94a3b8').text(
      '* required for a final version. Generated by SentRAI from the model record and its governance registers; framework mappings come from the packs enabled for the organisation. A model card documents the system; it is not a certification.',
      48, doc.y, { width: W },
    );
    doc.end();
  });
}
