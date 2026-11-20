import { sanitiseSuggestion } from './sanitise';

// The real v1 text from the "Global Ai Model Settings" record (defects D3, D4).
const V1_PURPOSE = [
  'Here is a concise, plain-language summary of the "Global Ai Model Settings" software component:',
  '**What it does:** This component manages the default AI model settings for a platform, which applies to every organization unless they have their own "Bring Your Own Key" (BYOK) toggle enabled.',
  '**Personal data processing:** This component processes personal data, as it interacts with an API endpoint that likely handles sensitive information related to the AI model settings.',
  'Note: This summary is based on the provided code excerpt and may not be comprehensive or up-to-date, as the code may have been modified or extended since the excerpt was taken.',
].join('\n\n');

describe('AI suggestion clean-up', () => {
  it('removes the preamble, the closing disclaimer and the speculative sentence from the v1 purpose', () => {
    const r = sanitiseSuggestion(V1_PURPOSE);
    expect(r.text.startsWith('**What it does:**')).toBe(true);
    expect(r.text).not.toMatch(/Here is/);
    expect(r.text).not.toMatch(/code excerpt/);
    expect(r.text).not.toMatch(/likely/);
    expect(r.speculative).toBe(true);
    expect(r.removed).toHaveLength(3);
  });

  it('removes a one-line preamble sentence that shares a paragraph with content', () => {
    const r = sanitiseSuggestion('Here is a rationale for why the AI model is classified LOW risk: The component sets defaults. It reaches every tenant.');
    expect(r.text).toBe('The component sets defaults. It reaches every tenant.');
  });

  it('leaves clean text and lists alone', () => {
    const clean = 'Scores SME credit applications.\n\n- Used by underwriters\n- May be overridden by a credit officer';
    expect(sanitiseSuggestion(clean)).toEqual({ text: clean, removed: [], speculative: false });
  });

  it('handles empty input', () => {
    expect(sanitiseSuggestion(null)).toEqual({ text: '', removed: [], speculative: false });
  });
});
