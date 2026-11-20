/**
 * Cleans an AI draft before anyone sees it (model card v2, defect D3/D4).
 *
 * LLMs wrap answers in chat framing ("Here is a concise summary of ...:",
 * "Sure, ...") and close with disclaimers about the excerpt they were given.
 * That text is not content: it is removed. Sentences that guess at a fact
 * ("likely handles personal data") are removed too and reported, because an
 * undetermined fact must read as UNKNOWN, not as a hedge. What was removed is
 * returned so the card can say so next to the suggestion.
 */

export interface SanitisedDraft {
  text: string;
  /** Removed preamble, disclaimer or speculative sentences, verbatim. */
  removed: string[];
  /** True when at least one speculative sentence was removed. */
  speculative: boolean;
}

const PREAMBLE = /^(?:\*\*)?\s*(?:here(?:'s| is| are)\b|sure\b|certainly\b|of course\b|absolutely\b|below is\b|ok(?:ay)?\b[,.!]|great question\b|i (?:have|'ve) (?:drafted|written|prepared)\b)/i;
const DISCLAIMER = /^(?:\*\*)?\s*(?:note|disclaimer|please note|caveat|important)\s*[:*]|\b(?:based (?:only |solely )?on the (?:provided|given|supplied) (?:code|excerpt|snippet|information)|may not be (?:comprehensive|complete|up-to-date|up to date|accurate)|as an ai\b|i (?:cannot|can't|am unable to) (?:verify|confirm|access))/i;
const SPECULATION = /\b(?:likely|probably|presumably|possibly|appears to|seems to|it is possible that|might be|may be (?:handling|processing|used|storing))\b/i;

const sentences = (para: string): string[] => para.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];

export function sanitiseSuggestion(raw: string | null | undefined): SanitisedDraft {
  const removed: string[] = [];
  let speculative = false;
  let paras = String(raw ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  // A leading preamble paragraph (often ending with ':'), or a preamble first sentence.
  if (paras.length && PREAMBLE.test(paras[0])) {
    const first = sentences(paras[0]);
    const colon = first[0].indexOf(':');
    if (paras[0].endsWith(':')) removed.push(paras.shift()!);
    else if (colon > 0 && colon < first[0].length - 1) {
      // "Here is X: actual content." keeps the content after the colon.
      removed.push(paras[0].slice(0, colon + 1));
      paras[0] = paras[0].slice(colon + 1).trim();
    } else if (first.length <= 1) removed.push(paras.shift()!);
    else {
      removed.push(first[0]);
      paras[0] = first.slice(1).join(' ');
    }
  }
  // Trailing disclaimers.
  while (paras.length && DISCLAIMER.test(paras[paras.length - 1])) removed.push(paras.pop()!);

  // Speculative sentences inside the body.
  paras = paras
    .map((p) => {
      if (/^\s*([-*+•]|\d+[.)])\s/.test(p) || !SPECULATION.test(p)) return p;
      const kept = sentences(p).filter((s) => {
        if (!SPECULATION.test(s)) return true;
        removed.push(s);
        speculative = true;
        return false;
      });
      return kept.join(' ');
    })
    .filter((p) => p.replace(/[*_#\s]/g, '').length > 0 && !/^\*\*[^*]+:\*\*$/.test(p));

  return { text: paras.join('\n\n').trim(), removed, speculative };
}
