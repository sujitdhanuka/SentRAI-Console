/**
 * E5.1 EU AI Act units: profile validation, Art. 5 and Art. 6 rules, tier
 * derivation, Annex IV readiness, Annex VIII sections, Art. 73 clocks, the
 * EU controls, and the pack engine's roles and per-article dates.
 */
import { EPIC_FLAGS, flagSet } from '../../common/feature-flags';
import { getControl } from '../controls/control-library';
import { evaluatePack } from '../packs/pack-engine';
import { PackRegistry } from '../packs/pack-loader';
import { resolveParameters } from '../packs/parameter-resolver';
import {
  annexIV,
  art5Result,
  deriveTier,
  euDeadline,
  euIncidentStatus,
  explanationText,
  mergeProfile,
  parseArt5,
  parseClassification,
  registrationSections,
} from './eu-act.model';

const NOW = new Date('2026-11-19T12:00:00Z');
const signedArt5 = (answers: Record<string, any>) => ({ answers, signedBy: 'o@x', signedAt: NOW.toISOString() });
const allNo = Object.fromEntries(['manipulation', 'vulnerabilities', 'social_scoring', 'crime_prediction', 'facial_scraping', 'emotion_work_school', 'biometric_categorisation', 'realtime_rbi'].map((k) => [k, { answer: 'NO' }]));

describe('EU profile', () => {
  it('keeps only known fields, checks types and normalises roles and dates', () => {
    const { profile, errors, changed } = mergeProfile({}, { roles: ['provider'], provider: { name: ' Acme ', establishedInEu: 'yes' }, unknown: 1, 'market.placedOnMarketAt': '2026-09-01T10:00:00Z' });
    expect(errors).toEqual(['provider.establishedInEu must be true or false']);
    expect(profile).toEqual({ roles: ['PROVIDER'], provider: { name: 'Acme' }, market: { placedOnMarketAt: '2026-09-01' } });
    expect(changed).toEqual(expect.arrayContaining(['roles', 'provider.name']));
    expect(mergeProfile({}, { roles: ['OWNER'] }).errors[0]).toMatch(/roles must be/);
    expect(mergeProfile({ provider: { name: 'A' } }, { provider: { name: '' } }).profile.provider.name).toBeNull();
  });
});

describe('Art. 5 and Art. 6', () => {
  it('needs every answer, allows exceptions only where the Act has them, and flags a prohibited practice', () => {
    expect(parseArt5({ social_scoring: { answer: 'YES', exception: 'x'.repeat(30) } }).errors[0]).toMatch(/has no exception/);
    expect(parseArt5({ realtime_rbi: { answer: 'YES', exception: 'short' } }).errors[0]).toMatch(/at least 20/);
    const ok = parseArt5({ realtime_rbi: { answer: 'YES', exception: 'Targeted search for a missing child under judicial authorisation' } });
    expect(ok.errors).toEqual([]);
    const r = art5Result({ answers: { ...allNo, ...ok.answers, social_scoring: { answer: 'YES' } } as any });
    expect(r.complete).toBe(true);
    expect(r.prohibited).toEqual(['social_scoring']);
    expect(r.excepted).toEqual(['realtime_rbi']);
  });

  it('refuses a derogation for profiling or without reasoning', () => {
    expect(parseClassification({ annex_iii: ['5(b)'], profiling: true, derogation: 'PREPARATORY', derogation_reasoning: 'x'.repeat(60) }).errors.join()).toMatch(/always high-risk/);
    expect(parseClassification({ annex_iii: ['5(b)'], profiling: false, derogation: 'PREPARATORY' }).errors.join()).toMatch(/document the derogation/);
    expect(parseClassification({ annex_iii: ['9(z)'] }).errors.join()).toMatch(/unknown points/);
  });

  it('derives the tier from the signed records, keeping the hint until they are signed', () => {
    const cls = (v: any) => ({ annexIII: [], annexIProduct: false, profiling: null, derogation: null, derogationReasoning: null, signedAt: NOW.toISOString(), ...v });
    expect(deriveTier({}, null, null, NOW).tier).toBeNull();
    expect(deriveTier({}, signedArt5({ ...allNo, social_scoring: { answer: 'YES' } }), null, NOW).tier).toBe('Prohibited');
    expect(deriveTier({}, signedArt5(allNo), cls({ annexIII: ['4(a)'] }), NOW).tier).toBe('High Risk');
    const derog = deriveTier({}, signedArt5(allNo), cls({ annexIII: ['5(b)'], profiling: false, derogation: 'PREPARATORY' }), NOW);
    expect(derog).toMatchObject({ tier: 'Minimal Risk', derogation: true });
    expect(deriveTier({ art50: { interactsWithPersons: true } }, null, cls({}), NOW).tier).toBe('Limited Risk');
    // Annex I products are high-risk only from 2 Aug 2027 (Art. 113(c)).
    expect(deriveTier({}, null, cls({ annexIProduct: true }), NOW).tier).toBe('Minimal Risk');
    expect(deriveTier({}, null, cls({ annexIProduct: true }), new Date('2027-08-02T00:00:00Z')).tier).toBe('High Risk');
    // An unsigned classification is ignored.
    expect(deriveTier({}, null, cls({ annexIII: ['4(a)'], signedAt: null }), NOW).tier).toBeNull();
  });

  it('works out the Annex VIII sections from the roles and the classification', () => {
    expect(registrationSections(['PROVIDER'], 'High Risk', false, {})).toEqual(['A']);
    expect(registrationSections(['PROVIDER'], 'Minimal Risk', true, {})).toEqual(['B']);
    expect(registrationSections(['DEPLOYER'], 'High Risk', false, { market: { publicAuthorityDeployer: true } })).toEqual(['C']);
    expect(registrationSections(['DEPLOYER'], 'High Risk', false, {})).toEqual([]);
  });
});

describe('Annex IV readiness', () => {
  const input = (profile: any) => ({
    model: { name: 'M', modelType: 'ML', functionalArea: 'credit', useCaseDescription: 'Scores SME credit applications for underwriting', developedBy: 'in-house', ownerTeam: 'Risk', humanOversightRequired: true, sourceRefs: ['repo@abc'], dependencies: [], performanceBenchmarks: [{ metric: 'AUC', value: 0.8 }] },
    profile, contextProfile: { knownLimitations: ['Not for mortgages'], oversightPattern: 'HUMAN_IN_THE_LOOP' },
    datasets: [{ name: 'apps-2025', provenance: 'core banking', lawfulBasis: 'contract' }],
    tevv: { testSets: 1, withCriteria: 1, latestPassing: 1, segments: ['age'] }, validations: 1, risks: { assessed: 3 }, cardVersions: 1, ledgerEvents: 4, declaration: null,
  });
  it('scores the required fields and names the incomplete sections', () => {
    const empty = annexIV(input({}));
    expect(empty.score).toBeLessThan(100);
    expect(empty.missing).toEqual(expect.arrayContaining(['Elements and development process', 'Post-market monitoring plan (Art. 72(3))']));
    const full = annexIV(input({
      provider: { name: 'Acme' }, instructions: { declaredAccuracy: 'AUC 0.80', inputSpecification: 'Application form fields' },
      annexIV: { designChoices: 'GBM', architecture: 'Batch scorer', computeResources: '4 vCPU', cybersecurity: 'Signed artefacts', standardsApplied: ['ISO/IEC 42001'] },
      pmm: { dataCollected: 'Scores and outcomes', metrics: 'PSI, AUC', reviewFrequencyMonths: 6, owner: 'Model risk' },
    }));
    expect(full.score).toBe(100);
    expect(full.sections).toHaveLength(9);
  });
});

describe('Art. 73 clocks', () => {
  it('gives 2, 10 or 15 days from awareness and reports what is open', () => {
    const aware = new Date('2026-11-01T00:00:00Z');
    expect(euDeadline('WIDESPREAD_INFRINGEMENT', aware)!.toISOString()).toBe('2026-11-03T00:00:00.000Z');
    expect(euDeadline('DEATH', aware)!.toISOString()).toBe('2026-11-11T00:00:00.000Z');
    expect(euDeadline('FUNDAMENTAL_RIGHTS', aware)!.toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(euDeadline('NOT_SERIOUS', aware)).toBeNull();
    const s = euIncidentStatus({ classification: 'DEATH', deadlineAt: '2026-11-11T00:00:00Z' }, { severity: 'P1_CRITICAL', status: 'OPEN' }, NOW, ['DEPLOYER']);
    expect(s.overdue).toBe(true);
    expect(s.problems).toEqual(expect.arrayContaining(['provider not informed (Art. 26(5))']));
    expect(euIncidentStatus(null, { severity: 'P2_HIGH', status: 'OPEN' }, NOW, []).problems[0]).toMatch(/not classified/);
    expect(euIncidentStatus(null, { severity: 'P4_LOW', status: 'OPEN' }, NOW, []).problems).toEqual([]);
  });

  it('writes an Art. 86 explanation from the main elements', () => {
    const t = explanationText({ modelName: 'Scorer', decisionRef: 'D1', outcome: 'DECLINED', method: 'SHAP', topFeatures: { a: 0.1, dti: -0.7 }, summary: 'x', humanOversight: true });
    expect(t).toMatch(/Main elements of the decision: dti \(-0.70\), a \(\+0.10\)/);
    expect(t).toMatch(/a person reviewed it/);
  });
});

describe('EU controls and the EU pack', () => {
  const env = (vars: Record<string, string | undefined>, fn: () => void) => {
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { fn(); } finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };
  const entry: any = { modelId: 'm1', name: 'M', modelType: 'MACHINE_LEARNING', functionalArea: 'credit_underwriting', riskLevel: 'HIGH', useCaseDescription: 'Scores SME credit applications', ownerTeam: 'Risk', boardPolicyRef: 'BP', humanOversightRequired: true, evidenceArtifacts: [], dependencies: [] };
  const params = resolveParameters([{ source: 'eu-ai-act', parameters: { logRetentionMonths: 6 } }], {});
  const facts = (over: any = {}) => ({
    roles: ['DEPLOYER'], scopeDecided: true, inScope: true, tier: 'High Risk', basis: 'Annex III 5(b)', art5: { signed: true, prohibited: [], signedBy: 'o', signedAt: '2026-11-01' },
    classification: { signed: true, annexIII: ['5(b)'] }, provider: { missing: [] }, annexIV: { score: 100, missing: [] }, instructions: { missing: [] },
    conformity: { status: 'PASSED' }, declaration: { issued: true }, ce: { affixed: true }, registration: { required: [], missing: [] }, art50: { missing: [] },
    data: { missing: [] }, deployer: { missing: [] }, fria: { required: true, signed: true, notified: false }, gpai: { applies: false }, verification: { missing: [] },
    valueChain: { open: 0 }, nonconformity: { open: 0 }, rwt: { plans: 0 }, pmm: { missing: [] }, incidents: { overdue: 0, problems: [] }, explanations: { overdue: 0 }, retention: { applies: false }, ...over,
  });

  it('reports NOT ASSESSED without the EU facts, and not applicable where a duty does not apply', () => {
    const run = (id: string, ctx: any) => getControl(id)!.evaluate({ entry, ctx, params, flags: flagSet(true), opts: {}, now: NOW });
    expect(run('CTL-EU-ART5', {}).notAssessed).toBe(true);
    expect(run('CTL-EU-REGISTRATION', { governance: { euAct: facts() } })).toMatchObject({ passed: true, key: 'not_applicable', notAssessed: true });
    expect(run('CTL-EU-FRIA', { governance: { euAct: facts() } })).toMatchObject({ passed: false, key: 'not_notified' });
    expect(run('CTL-EU-ORG', { org: { euAct: { authRepRequired: true, authRep: false, logStores: ['telemetry'], logRetention: { telemetry: 3 } } } }).facts.missing)
      .toBe('authorised representative (Art. 22); telemetry logs kept 3 months, below 6');
  });

  it('serves the EU pack exactly as before while GOV_E5_1_EU_ACT is off, and applies roles, dates and the signed tier when it is on', () => {
    const PRE_EU = '8cf40ed1a8aafd6589a232aa800e3ca794775f84616b8c913e3d2e980301faf5';
    env({ GOVERNANCE_V2: 'true', [EPIC_FLAGS.euAiAct]: 'false' }, () => {
      const v = new PackRegistry().versions('eu-ai-act')[0];
      expect(v.contentHash).toBe(PRE_EU);
      expect(v.definition.parameters.logRetentionMonths).toBeUndefined();
      expect(v.definition.clauses.some((c) => c.roles || c.effectiveFrom)).toBe(false);
    });
    env({ GOVERNANCE_V2: 'true' }, () => {
      const reg = new PackRegistry();
      const v = reg.versions('eu-ai-act')[0];
      expect(v.contentHash).not.toBe(PRE_EU);
      expect(v.definition.parameters.logRetentionMonths).toBe(6);
      const flags = flagSet(true);
      const codes = (ctx: any, now = NOW) => evaluatePack(v, entry, ctx, { flags, params, now }).clauses.map((c) => c.code);
      // No EU facts (pack not enabled for the organisation): only the original clauses run.
      expect(codes({})).not.toContain('Art-5');
      // Deployer only: the provider clauses drop out.
      const dep = codes({ governance: { euAct: facts() } });
      expect(dep).toEqual(expect.arrayContaining(['Art-5', 'Art-26', 'Art-27', 'Art-86']));
      expect(dep).not.toContain('Art-43');
      expect(dep).not.toContain('Art-9');
      // Before 2 Aug 2026 the general obligations are not yet in force; Art. 5 already is.
      const early = codes({ governance: { euAct: facts({ roles: ['PROVIDER'] }) } }, new Date('2026-03-01T00:00:00Z'));
      expect(early).toContain('Art-5');
      expect(early).not.toContain('Art-43');
      // The signed tier wins over the keyword hint.
      const ev = evaluatePack(v, entry, { governance: { euAct: facts({ tier: 'Minimal Risk' }) } }, { flags, params, now: NOW });
      expect(ev.tier).toBe('Minimal Risk');
    });
  });
});
