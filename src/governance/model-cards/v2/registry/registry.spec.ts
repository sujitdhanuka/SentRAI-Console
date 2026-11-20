import { FIELDS } from '../catalogue';
import {
  adoptedFromPacks, applicabilityLabel, frameworkApplicability, normaliseFramework, RegistryContext, SEED_FRAMEWORKS, validateFrameworks,
} from './registry';

const at = new Date('2026-11-20T10:00:00Z');
const ctx = (facts: Record<string, unknown>, adopted: string[] = [], recordType: string | null = 'AI_SYSTEM', when = at): RegistryContext => ({
  recordType, facts, adopted: new Set(adopted), at: when,
});
const fw = (rows: ReturnType<typeof frameworkApplicability>, id: string) => rows.find((f) => f.framework_id === id)!;
const ctl = (rows: ReturnType<typeof frameworkApplicability>, id: string, c: string) => fw(rows, id).controls.find((x) => x.control_id === c)!;

describe('framework registry seed', () => {
  it('is valid, and every entry and control is unverified until legal review', () => {
    expect(validateFrameworks(SEED_FRAMEWORKS)).toEqual([]);
    for (const f of SEED_FRAMEWORKS) {
      expect(f.verification_status).toBe('UNVERIFIED_REQUIRES_LEGAL_REVIEW');
      for (const c of f.controls) expect(c.verification_status).toBe('UNVERIFIED_REQUIRES_LEGAL_REVIEW');
    }
  });

  it('contains every framework the spec lists', () => {
    const ids = SEED_FRAMEWORKS.map((f) => f.framework_id);
    expect(ids).toEqual(expect.arrayContaining([
      'nist-ai-rmf-1.0', 'nist-ai-600-1', 'iso-42001-2023', 'iso-23894-2023', 'iso-42005-2025', 'iso-22989-2022', 'oecd-ai-principles', 'sg-magf', 'sg-magf-genai',
      'eu-ai-act-2024', 'gdpr', 'in-dpdp-2023', 'in-dpdp-rules-2025', 'in-it-rules-2026', 'in-meity-ai-guidelines-2025', 'kr-ai-basic-act',
      'cn-ai-labelling', 'cn-genai-filing', 'us-federal-placeholder', 'us-co-sb26-189',
    ]));
  });

  it('has every framework control the catalogue references', () => {
    const known = new Set(SEED_FRAMEWORKS.flatMap((f) => f.controls.map((c) => `${f.framework_id}:${c.control_id}`)));
    const refs = [...new Set(FIELDS.flatMap((f) => f.framework_control_refs))];
    expect(refs.length).toBeGreaterThan(40);
    expect(refs.filter((r) => !known.has(r))).toEqual([]);
  });

  it('seeds the EU AI Act phases with the spec dates', () => {
    const eu = SEED_FRAMEWORKS.find((f) => f.framework_id === 'eu-ai-act-2024')!;
    expect(Object.fromEntries(eu.phases.map((p) => [p.phase_id, p.effective_from]))).toEqual({
      PROHIBITED: '2025-02-02', AI_LITERACY: '2025-02-02', GPAI: '2025-08-02', ART50: '2026-08-02', ANNEX_III: '2027-12-02', ANNEX_I: '2028-08-02',
    });
  });

  it('uses "obligation" only for law and regulation', () => {
    const rows = frameworkApplicability(SEED_FRAMEWORKS, ctx({}));
    expect(fw(rows, 'eu-ai-act-2024')).toMatchObject({ type: 'REGULATION', binding: true, noun: 'obligation' });
    expect(fw(rows, 'kr-ai-basic-act')).toMatchObject({ type: 'LAW', noun: 'obligation' });
    expect(fw(rows, 'iso-42001-2023')).toMatchObject({ type: 'STANDARD', binding: false, noun: 'control' });
    expect(fw(rows, 'nist-ai-rmf-1.0')).toMatchObject({ type: 'GUIDANCE', noun: 'practice' });
  });

  it('rejects entries with unknown rules, long titles or a law with no rule', () => {
    const bad = normaliseFramework({
      framework_id: 'x-law', type: 'LAW', title: 'X', controls: [{ control_id: 'A', title: 'y'.repeat(200), applicability_rule_id: 'R_NOPE' }],
    });
    const p = validateFrameworks([bad]).join(' | ');
    expect(p).toMatch(/must name the rule/);
    expect(p).toMatch(/one-line paraphrase/);
    expect(p).toMatch(/unknown rule R_NOPE/);
  });
});

describe('framework applicability', () => {
  it('applies no framework by default', () => {
    const rows = frameworkApplicability(SEED_FRAMEWORKS, ctx({}));
    expect(rows.filter((f) => f.applies === 'APPLIES')).toEqual([]);
  });

  it('applies standards and guidance only where the organisation adopted them', () => {
    const rows = frameworkApplicability(SEED_FRAMEWORKS, ctx({ model_category: 'TRADITIONAL_ML', uses_generative: false }, ['nist-ai-rmf-1.0', 'nist-ai-600-1']));
    expect(fw(rows, 'nist-ai-rmf-1.0')).toMatchObject({ applies: 'APPLIES', in_force: 'IN_FORCE' });
    expect(fw(rows, 'nist-ai-600-1').applies).toBe('DOES_NOT_APPLY');
    expect(fw(rows, 'iso-42001-2023').applies).toBe('DOES_NOT_APPLY');
    const gen = frameworkApplicability(SEED_FRAMEWORKS, ctx({ model_category: 'LLM' }, ['nist-ai-600-1']));
    expect(fw(gen, 'nist-ai-600-1').applies).toBe('APPLIES');
  });

  it('adopts NIST and ISO from the pack baseline, not the EU pack', () => {
    expect(adoptedFromPacks(SEED_FRAMEWORKS, null).sort()).toEqual(['iso-42001-2023', 'nist-ai-rmf-1.0']);
    expect(adoptedFromPacks(SEED_FRAMEWORKS, ['nist-ai-rmf', 'eu-ai-act'])).toEqual(['nist-ai-rmf-1.0']);
  });

  it('reports EU AI Act obligations that apply but are not yet in force', () => {
    const facts = { jurisdictions: ['EU'], eu_role: ['AI_SYSTEM_PROVIDER', 'DEPLOYER'], eu_classification: 'HIGH_RISK_ANNEX_III', model_category: 'LLM' };
    const rows = frameworkApplicability(SEED_FRAMEWORKS, ctx(facts));
    expect(fw(rows, 'eu-ai-act-2024')).toMatchObject({ applies: 'APPLIES', in_force: 'IN_FORCE' });
    expect(ctl(rows, 'eu-ai-act-2024', 'ART-4')).toMatchObject({ applies: 'APPLIES', in_force: 'IN_FORCE', effective_from: '2025-02-02' });
    expect(ctl(rows, 'eu-ai-act-2024', 'ART-50')).toMatchObject({ applies: 'APPLIES', in_force: 'IN_FORCE', phase_id: 'ART50' });
    const art9 = ctl(rows, 'eu-ai-act-2024', 'ART-9');
    expect(art9).toMatchObject({ applies: 'APPLIES', in_force: 'NOT_YET_IN_FORCE', effective_from: '2027-12-02', phase_id: 'ANNEX_III' });
    expect(applicabilityLabel(art9)).toBe('Applies, not yet in force');
    // GPAI duties bind GPAI model providers only.
    expect(ctl(rows, 'eu-ai-act-2024', 'ART-53').applies).toBe('DOES_NOT_APPLY');

    const annexI = frameworkApplicability(SEED_FRAMEWORKS, ctx({ ...facts, eu_classification: 'HIGH_RISK_ANNEX_I' }));
    expect(ctl(annexI, 'eu-ai-act-2024', 'ART-9')).toMatchObject({ effective_from: '2028-08-02', phase_id: 'ANNEX_I', in_force: 'NOT_YET_IN_FORCE' });

    const before = frameworkApplicability(SEED_FRAMEWORKS, ctx(facts, [], 'AI_SYSTEM', new Date('2026-03-01T00:00:00Z')));
    expect(ctl(before, 'eu-ai-act-2024', 'ART-50').in_force).toBe('NOT_YET_IN_FORCE');
  });

  it('never derives EU high-risk obligations from the internal risk tier', () => {
    const rows = frameworkApplicability(SEED_FRAMEWORKS, ctx({ jurisdictions: ['EU'], eu_role: ['AI_SYSTEM_PROVIDER'], eu_classification: 'MINIMAL', inherent_risk_tier: 'CRITICAL' }));
    expect(ctl(rows, 'eu-ai-act-2024', 'ART-9').applies).toBe('DOES_NOT_APPLY');
    const unclassified = frameworkApplicability(SEED_FRAMEWORKS, ctx({ jurisdictions: ['EU'], eu_role: ['AI_SYSTEM_PROVIDER'], inherent_risk_tier: 'CRITICAL' }));
    expect(ctl(unclassified, 'eu-ai-act-2024', 'ART-9')).toMatchObject({ applies: 'UNDETERMINED', in_force: 'DATE_UNKNOWN' });
  });

  it('says when a date is not known rather than inventing one', () => {
    const rows = frameworkApplicability(SEED_FRAMEWORKS, ctx({ personal_data: 'YES', jurisdictions: ['IN'] }));
    expect(fw(rows, 'in-dpdp-2023')).toMatchObject({ applies: 'APPLIES', in_force: 'DATE_UNKNOWN' });
    expect(applicabilityLabel(fw(rows, 'in-dpdp-2023'))).toBe('Applies, date to be confirmed');
    expect(fw(rows, 'gdpr').applies).toBe('DOES_NOT_APPLY');
  });

  it('applies the Colorado law only to consequential-decision uses in Colorado', () => {
    const yes = frameworkApplicability(SEED_FRAMEWORKS, ctx({ jurisdictions: ['US', 'US-CO'], us_consequential_decision: 'YES' }));
    expect(fw(yes, 'us-co-sb26-189').applies).toBe('APPLIES');
    const no = frameworkApplicability(SEED_FRAMEWORKS, ctx({ jurisdictions: ['US', 'US-CO'], us_consequential_decision: 'NO' }));
    expect(fw(no, 'us-co-sb26-189').applies).toBe('DOES_NOT_APPLY');
    const open = frameworkApplicability(SEED_FRAMEWORKS, ctx({ jurisdictions: ['US-CO'] }));
    expect(fw(open, 'us-co-sb26-189').applies).toBe('UNDETERMINED');
  });

  it('labels ISO/IEC 42001 as organisational and never says compliant or certified', () => {
    const rows = frameworkApplicability(SEED_FRAMEWORKS, ctx({}, ['iso-42001-2023']));
    const label = applicabilityLabel(fw(rows, 'iso-42001-2023'));
    expect(label).toMatch(/organisational standard: this card holds supporting evidence only/);
    const all = rows.flatMap((f) => [applicabilityLabel(f), ...f.controls.map((c) => applicabilityLabel(c))]).join(' ');
    expect(all).not.toMatch(/complian|certif/i);
  });
});
