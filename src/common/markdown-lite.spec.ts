import { mdBlocks, mdInline, mdPlain } from './markdown-lite';

describe('markdown-lite', () => {
  it('reads bold, italic, bold-italic and code', () => {
    expect(mdInline('**What it does:** manages *default* settings, ***always*** via `api`')).toEqual([
      { text: 'What it does:', bold: true },
      { text: ' manages ' },
      { text: 'default', italic: true },
      { text: ' settings, ' },
      { text: 'always', bold: true, italic: true },
      { text: ' via ' },
      { text: 'api', code: true },
    ]);
  });

  it('leaves snake_case, lone asterisks and maths alone', () => {
    expect(mdInline('model_risk_tier and 2 * 3 * 4')).toEqual([{ text: 'model_risk_tier and 2 * 3 * 4' }]);
  });

  it('splits paragraphs, headings and lists', () => {
    const b = mdBlocks('Intro line\nsame para\n\n## Risks\n- **one**\n* two\n1. three\n\nEnd');
    expect(b.map((x) => x.kind)).toEqual(['p', 'h', 'li', 'li', 'li', 'p']);
    expect(b[0].runs[0].text).toBe('Intro line same para');
    expect(b[2].runs).toEqual([{ text: 'one', bold: true }]);
    expect(b[4].marker).toBe('1.');
  });

  it('strips markers for plain text', () => {
    expect(mdPlain('**A:** b\n\n- *c*')).toBe('A: b\n• c');
  });
});
