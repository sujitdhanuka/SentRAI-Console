/**
 * A small, safe Markdown reader for free-text fields (model purpose, risk
 * rationale and similar text, often written by an LLM). It understands
 * paragraphs, headings, bullet and numbered lists, and inline bold, italic,
 * bold-italic and code. It never produces HTML: callers render the blocks and
 * runs themselves (pdfkit for the PDFs, React in the console), so text in a
 * field cannot inject markup. Anything it does not recognise stays as text.
 */

export interface MdRun { text: string; bold?: boolean; italic?: boolean; code?: boolean }
export interface MdBlock { kind: 'p' | 'h' | 'li'; marker?: string; level?: number; runs: MdRun[] }

const INLINE = /(\*\*\*|___)(?=\S)([\s\S]*?\S)\1|(\*\*|__)(?=\S)([\s\S]*?\S)\3|\*(?=[^\s*])([^*]*?[^\s*])\*|(?<![\w])_(?=[^\s_])([^_]*?[^\s_])_(?![\w])|`([^`]+)`/g;

/** Splits one line of text into styled runs. Emphasis may nest one level (bold inside italic and the reverse). */
export function mdInline(text: string, base: Omit<MdRun, 'text'> = {}): MdRun[] {
  const runs: MdRun[] = [];
  let last = 0;
  const push = (t: string, style: Omit<MdRun, 'text'>) => {
    if (!t) return;
    const prev = runs[runs.length - 1];
    if (prev && !!prev.bold === !!style.bold && !!prev.italic === !!style.italic && !!prev.code === !!style.code) prev.text += t;
    else runs.push({ text: t, ...(style.bold ? { bold: true } : {}), ...(style.italic ? { italic: true } : {}), ...(style.code ? { code: true } : {}) });
  };
  for (const m of text.matchAll(new RegExp(INLINE.source, 'g'))) {
    push(text.slice(last, m.index), base);
    if (m[2] !== undefined) for (const r of mdInline(m[2], { ...base, bold: true, italic: true })) push(r.text, r);
    else if (m[4] !== undefined) for (const r of mdInline(m[4], { ...base, bold: true })) push(r.text, r);
    else if (m[5] !== undefined) for (const r of mdInline(m[5], { ...base, italic: true })) push(r.text, r);
    else if (m[6] !== undefined) for (const r of mdInline(m[6], { ...base, italic: true })) push(r.text, r);
    else push(m[7], { ...base, code: true });
    last = m.index! + m[0].length;
  }
  push(text.slice(last), base);
  return runs;
}

/** Splits text into blocks. Consecutive non-blank lines join into one paragraph. */
export function mdBlocks(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', runs: mdInline(para.join(' ')) });
    para = [];
  };
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*$/))) {
      flush();
      blocks.push({ kind: 'h', level: m[1].length, runs: mdInline(m[2]) });
    } else if ((m = line.match(/^[-*+•]\s+(.*)$/))) {
      flush();
      blocks.push({ kind: 'li', marker: '•', level: raw.search(/\S/) >= 2 ? 2 : 1, runs: mdInline(m[1]) });
    } else if ((m = line.match(/^(\d{1,3})[.)]\s+(.*)$/))) {
      flush();
      blocks.push({ kind: 'li', marker: `${m[1]}.`, level: raw.search(/\S/) >= 2 ? 2 : 1, runs: mdInline(m[2]) });
    } else if (blocks.length && blocks[blocks.length - 1].kind === 'li' && !para.length && /^\s{2,}/.test(raw)) {
      blocks[blocks.length - 1].runs.push(...mdInline(` ${line}`));
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

/** The text with all Markdown markers removed, for places that show plain text. */
export function mdPlain(text: string): string {
  return mdBlocks(text).map((b) => `${b.kind === 'li' ? `${b.marker} ` : ''}${b.runs.map((r) => r.text).join('')}`).join('\n');
}
