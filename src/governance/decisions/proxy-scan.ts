/**
 * Fair-lending proxy scan (E2.4, ECOA / Reg B): looks for prohibited bases and
 * likely proxies among a model's inputs (declared features, reason-code map
 * features, the features its decision explanations weigh, and the context
 * profile's system requirements). Matching is on normalised feature names,
 * so "applicant_zip_code" and "ZipCode" both match "zip". An organisation can
 * add terms in governance settings (fairLending.proxyTerms).
 *
 * A hit is a prompt for review, not a verdict: a lender may justify a
 * feature (for example, postcode used only for fraud checks) and the
 * justification is recorded with the scan.
 */
export interface ProxyTerm {
  term: string;
  /** Prohibited basis this term is, or may stand in for. */
  basis: string;
  /** DIRECT: the term names a prohibited basis; PROXY: it is a likely stand-in. */
  kind: 'DIRECT' | 'PROXY';
}

export const PROHIBITED_BASES = [
  'race', 'color', 'religion', 'national origin', 'sex', 'marital status', 'age', 'receipt of public assistance', 'exercise of consumer credit rights',
] as const;

export const BUILT_IN_TERMS: ProxyTerm[] = [
  { term: 'race', basis: 'race', kind: 'DIRECT' },
  { term: 'ethnicity', basis: 'race', kind: 'DIRECT' },
  { term: 'colour', basis: 'color', kind: 'DIRECT' },
  { term: 'skin', basis: 'color', kind: 'DIRECT' },
  { term: 'religion', basis: 'religion', kind: 'DIRECT' },
  { term: 'church', basis: 'religion', kind: 'PROXY' },
  { term: 'nationality', basis: 'national origin', kind: 'DIRECT' },
  { term: 'national origin', basis: 'national origin', kind: 'DIRECT' },
  { term: 'citizenship', basis: 'national origin', kind: 'PROXY' },
  { term: 'immigration', basis: 'national origin', kind: 'PROXY' },
  { term: 'country of birth', basis: 'national origin', kind: 'PROXY' },
  { term: 'language', basis: 'national origin', kind: 'PROXY' },
  { term: 'sex', basis: 'sex', kind: 'DIRECT' },
  { term: 'gender', basis: 'sex', kind: 'DIRECT' },
  { term: 'title', basis: 'sex', kind: 'PROXY' },
  { term: 'salutation', basis: 'sex', kind: 'PROXY' },
  { term: 'marital', basis: 'marital status', kind: 'DIRECT' },
  { term: 'spouse', basis: 'marital status', kind: 'PROXY' },
  { term: 'age', basis: 'age', kind: 'DIRECT' },
  { term: 'date of birth', basis: 'age', kind: 'PROXY' },
  { term: 'dob', basis: 'age', kind: 'PROXY' },
  { term: 'birth year', basis: 'age', kind: 'PROXY' },
  { term: 'public assistance', basis: 'receipt of public assistance', kind: 'DIRECT' },
  { term: 'welfare', basis: 'receipt of public assistance', kind: 'PROXY' },
  { term: 'snap', basis: 'receipt of public assistance', kind: 'PROXY' },
  { term: 'benefits income', basis: 'receipt of public assistance', kind: 'PROXY' },
  { term: 'zip', basis: 'race / national origin', kind: 'PROXY' },
  { term: 'postcode', basis: 'race / national origin', kind: 'PROXY' },
  { term: 'postal code', basis: 'race / national origin', kind: 'PROXY' },
  { term: 'census tract', basis: 'race / national origin', kind: 'PROXY' },
  { term: 'neighborhood', basis: 'race / national origin', kind: 'PROXY' },
  { term: 'neighbourhood', basis: 'race / national origin', kind: 'PROXY' },
  { term: 'first name', basis: 'sex / race / national origin', kind: 'PROXY' },
  { term: 'given name', basis: 'sex / race / national origin', kind: 'PROXY' },
  { term: 'surname', basis: 'race / national origin', kind: 'PROXY' },
  { term: 'last name', basis: 'race / national origin', kind: 'PROXY' },
  { term: 'photo', basis: 'race / color / sex / age', kind: 'PROXY' },
  { term: 'pregnan', basis: 'sex', kind: 'PROXY' },
  { term: 'dispute', basis: 'exercise of consumer credit rights', kind: 'PROXY' },
];

/** "applicantZipCode" / "applicant-zip_code" → "applicant zip code". */
export function normaliseFeature(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Whole-word match of a term in a normalised name; stems of six letters or more ("pregnan") match as prefixes. */
function matches(normalised: string, term: string): boolean {
  const t = normaliseFeature(term);
  const words = normalised.split(' ');
  const tw = t.split(' ');
  const wordMatch = (w: string, x: string) => w === x || w === `${x}s` || (x.length >= 6 && w.startsWith(x));
  for (let i = 0; i + tw.length <= words.length; i++) {
    if (tw.every((w, j) => wordMatch(words[i + j], w))) return true;
  }
  // Compact forms in one word: "zipcode", "dateofbirth", "firstname".
  const compact = t.replace(/ /g, '');
  return words.some((w) => w === compact || w === `${compact}s` || w === `${compact}code`);
}

export interface ProxyHit {
  feature: string;
  term: string;
  basis: string;
  kind: 'DIRECT' | 'PROXY';
}

export function scanFeatures(features: string[], extra: Array<{ term: string; basis: string }> = []): ProxyHit[] {
  const terms: ProxyTerm[] = [...BUILT_IN_TERMS, ...extra.map((e) => ({ term: e.term, basis: e.basis, kind: 'PROXY' as const }))];
  const hits: ProxyHit[] = [];
  const seen = new Set<string>();
  for (const f of [...new Set(features.filter((x) => typeof x === 'string' && x.trim()))]) {
    const n = normaliseFeature(f);
    for (const t of terms) {
      if (!matches(n, t.term)) continue;
      const key = `${f}|${t.basis}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ feature: f, term: t.term, basis: t.basis, kind: t.kind });
    }
  }
  return hits;
}
