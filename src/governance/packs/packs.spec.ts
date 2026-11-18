/**
 * E1.1 pack engine units: schema validation, content hashing, effective-date
 * version selection, diffs, the strictest-wins resolver rules, pack floors,
 * evidence reuse across packs, and the plugin adapter.
 */
import { RiskLevel, SutraAlignment } from '../../common/enums';
import { FeatureFlags } from '../../common/feature-flags';
import { COMPLIANCE_FIXTURES } from '../../../test/fixtures/compliance-fixtures';
import { getControl, listControls } from '../controls/control-library';
import { diffPacks } from './pack-diff';
import { evaluatePack, resolveForPacks } from './pack-engine';
import { BUILT_IN_PACKS, canonicalJson, packContentHash, PackRegistry, packRegistry, validatePack } from './pack-loader';
import { PackDefinition } from './pack.types';
import { atLeastAsStrict, packFloors, PLATFORM_DEFAULTS, resolveParameters } from './parameter-resolver';
import { evaluatePluginViaPack } from './plugin-adapter';

const ON: FeatureFlags = { governanceV2: true, redTeamIntervals: true, bcpDrills: true, nistPrivacy: true, packEngine: true };
const nist = BUILT_IN_PACKS.find((p) => p.id === 'nist-ai-rmf')!;
const clone = (p: PackDefinition): PackDefinition => JSON.parse(JSON.stringify(p));

describe('pack schema', () => {
  it('every built-in pack is valid and maps only to library controls', () => {
    for (const p of BUILT_IN_PACKS) expect(validatePack(p)).toEqual([]);
  });

  it('rejects unknown controls, unknown parameters, bad mandatory rules and invented codes', () => {
    const bad = clone(nist);
    bad.clauses[0].control = 'CTL-NOPE';
    bad.clauses[1].code = 'GOVERN-9.9';
    bad.clauses[2].mandatory = { riskIn: ['SEVERE' as RiskLevel] };
    bad.parameters = { notAParameter: 1 };
    const errs = validatePack(bad).join('\n');
    expect(errs).toMatch(/unknown control CTL-NOPE/);
    expect(errs).toMatch(/GOVERN-9.9: not a NIST AI RMF subcategory/);
    expect(errs).toMatch(/mandatory.riskIn/);
    expect(errs).toMatch(/unknown parameter notAParameter/);
    expect(() => new PackRegistry([bad])).toThrow(/Invalid governance pack/);
  });

  it('the hash is stable under key order and changes with content', () => {
    const reordered = JSON.parse(canonicalJson(nist));
    expect(packContentHash(reordered)).toBe(packContentHash(nist));
    const changed = clone(nist);
    changed.clauses[0].gap = 'different';
    expect(packContentHash(changed)).not.toBe(packContentHash(nist));
    expect(packContentHash(nist)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('every library control is used by at least one pack or reserved for a later epic', () => {
    const used = new Set(BUILT_IN_PACKS.flatMap((p) => p.clauses.map((c) => c.control)));
    for (const c of listControls()) expect(used.has(c.id)).toBe(true);
  });
});

describe('pack versions and effective dates', () => {
  const v2 = { ...clone(nist), version: '1.1.0', effectiveFrom: '2027-03-01', changelog: [...nist.changelog, '1.1.0: MANAGE 2.4 mandatory for every tier'] };
  v2.clauses.find((c) => c.code === 'MANAGE-2.4')!.mandatory = true;
  v2.parameters = { driftRecencyDays: 14 };
  const reg = new PackRegistry([nist, v2]);

  it('a future version is UPCOMING, the current one ACTIVE, and supersession RETIRES the old one', () => {
    const now = new Date('2026-11-18');
    expect(reg.versions('nist-ai-rmf', now).map((v) => [v.definition.version, v.status])).toEqual([['1.0.0', 'ACTIVE'], ['1.1.0', 'UPCOMING']]);
    const later = new Date('2027-04-01');
    expect(reg.versions('nist-ai-rmf', later).map((v) => v.status)).toEqual(['RETIRED', 'ACTIVE']);
  });

  it('versionAt picks the version in force on a past or future date', () => {
    expect(reg.versionAt('nist-ai-rmf', new Date('2026-12-01'))!.definition.version).toBe('1.0.0');
    expect(reg.versionAt('nist-ai-rmf', new Date('2027-03-01'))!.definition.version).toBe('1.1.0');
    expect(reg.versionAt('nist-ai-rmf', new Date('2020-01-01'))).toBeNull();
  });

  it('the diff names changed clauses, parameters and changelog lines', () => {
    const d = diffPacks(nist, v2);
    expect(d.clauses.changed).toEqual([{ code: 'MANAGE-2.4', name: 'Fallback / Business-Continuity Plan', fields: ['mandatory'] }]);
    expect(d.clauses.added).toEqual([]);
    expect(d.parameters).toEqual([{ name: 'driftRecencyDays', from: null, to: 14 }]);
    expect(d.changelog).toEqual(['1.1.0: MANAGE 2.4 mandatory for every tier']);
  });

  it('rejects two definitions with the same id and version', () => {
    expect(() => new PackRegistry([nist, clone(nist)])).toThrow(/Duplicate pack version/);
  });
});

describe('strictest-wins resolver', () => {
  it('intervals and deadlines: shortest wins and names the pack', () => {
    const r = resolveParameters([
      { source: 'rbi-free-ai', parameters: { incidentReportHours: 24 } },
      { source: 'eu-ai-act', parameters: { incidentReportHours: 72 } },
    ]);
    expect(r.values.incidentReportHours).toBe(24);
    expect(r.sources.incidentReportHours.setBy).toEqual(['rbi-free-ai']);
    expect(r.sources.incidentReportHours.candidates).toHaveLength(2);
  });

  it('thresholds: most conservative wins in the parameter’s direction', () => {
    const r = resolveParameters([
      { source: 'a', parameters: { psiAlertThreshold: 0.1, fairnessRatioMin: 0.8 } },
      { source: 'b', parameters: { psiAlertThreshold: 0.05, fairnessRatioMin: 0.9 } },
    ]);
    expect(r.values.psiAlertThreshold).toBe(0.05);
    expect(r.values.fairnessRatioMin).toBe(0.9);
  });

  it('evidence and rights: union of all; required sign-offs: true wins', () => {
    const r = resolveParameters([
      { source: 'a', parameters: { requiredEvidence: ['bias_test'], 'thirdPartyAuditRequired.HIGH': false } },
      { source: 'b', parameters: { requiredEvidence: ['bias_test', 'dpia'], 'thirdPartyAuditRequired.HIGH': true } },
    ]);
    expect(r.values.requiredEvidence).toEqual(['bias_test', 'dpia']);
    expect(r.values['thirdPartyAuditRequired.HIGH']).toBe(true);
    expect(r.sources['thirdPartyAuditRequired.HIGH'].setBy).toEqual(['b']);
  });

  it('a tie names every pack that set the value', () => {
    const r = resolveParameters([{ source: 'a', parameters: { driftRecencyDays: 30 } }, { source: 'b', parameters: { driftRecencyDays: 30 } }]);
    expect(r.sources.driftRecencyDays.setBy).toEqual(['a', 'b']);
  });

  it('platform defaults apply only where nothing else set a value', () => {
    const r = resolveParameters([{ source: 'a', parameters: { driftRecencyDays: 7 } }], PLATFORM_DEFAULTS);
    expect(r.values.driftRecencyDays).toBe(7);
    expect(r.values['redTeamIntervalDays.HIGH']).toBe(90);
    expect(r.sources['redTeamIntervalDays.HIGH'].setBy).toEqual(['platform-default']);
  });

  it('strictness comparison drives the settings floor check', () => {
    expect(atLeastAsStrict('min', 60, 90)).toBe(true);
    expect(atLeastAsStrict('min', 120, 90)).toBe(false);
    expect(atLeastAsStrict('max', 0.9, 0.8)).toBe(true);
    expect(atLeastAsStrict('any', false, true)).toBe(false);
    expect(atLeastAsStrict('union', ['a', 'b'], ['a'])).toBe(true);
    expect(atLeastAsStrict('union', ['a'], ['a', 'b'])).toBe(false);
  });

  it('pack floors come from enabled packs only', () => {
    const floors = packFloors(BUILT_IN_PACKS.filter((p) => ['rbi-free-ai', 'eu-ai-act'].includes(p.id)));
    expect(floors.incidentReportHours).toEqual({ value: 24, packs: ['rbi-free-ai'] });
    expect(floors['thirdPartyAuditRequired.HIGH']).toEqual({ value: true, packs: ['rbi-free-ai'] });
    expect(packFloors(BUILT_IN_PACKS.filter((p) => p.baseline)).incidentReportHours).toBeUndefined();
  });

  it('a stricter red-team interval from a source tightens the check', () => {
    const fx = COMPLIANCE_FIXTURES.find((f) => f.id === 'high-governed')!; // red teamed 40 days ago
    const pack = packRegistry().versionAt('nist-ai-rmf')!;
    const loose = evaluatePack(pack, fx.entry, fx.ctx, { flags: ON, params: resolveForPacks([pack]) });
    const strict = evaluatePack(pack, fx.entry, fx.ctx, {
      flags: ON,
      params: resolveForPacks([pack], [{ source: 'settings', parameters: { 'redTeamIntervalDays.HIGH': 30 } }]),
    });
    const rt = (e: typeof loose) => e.clauses.find((c) => c.code === 'MEASURE-2.7')!;
    expect(rt(loose).passed).toBe(true);
    expect(rt(strict).passed).toBe(false);
    expect(rt(strict).gap).toContain('within 30 days');
  });
});

describe('evidence reuse and the plugin adapter', () => {
  it('one bias-test artifact is reported under every pack clause mapped to its control', () => {
    const fx = COMPLIANCE_FIXTURES.find((f) => f.id === 'high-governed')!;
    const packs = packRegistry().activeAt();
    const refs = packs.flatMap((p) =>
      evaluatePack(p, fx.entry, fx.ctx, { flags: ON }).clauses.filter((c) => c.evidenceRefs.includes('doc://bias')).map((c) => `${p.definition.id}:${c.code}`),
    );
    expect(refs).toEqual(expect.arrayContaining(['eu-ai-act:Art-10', `rbi-free-ai:${SutraAlignment.FAIRNESS}`]));
    expect(getControl('CTL-FAIR-01')!.evidenceTypes).toContain('bias_test');
  });

  it('with the pack engine, the ISO plugin no longer passes A.6.2.2 / A.8.2 on use-case text', () => {
    const r = evaluatePluginViaPack('ISO_42001', { risk_level: 'HIGH', owner_team: 'x', board_policy_ref: 'p', use_case_description: 'u'.repeat(400), lifecycle_stage: 'DEPLOYED' }, ON);
    const all = [...r.passedControls, ...r.blockingGaps, ...r.majorGaps, ...r.minorGaps].map((c) => c.controlId);
    expect(all).not.toContain('ISO42001-A.6.2.2');
    expect(all).not.toContain('ISO42001-A.8.2');
    const ia = r.minorGaps.find((c) => c.controlId === 'AIMS-8.4');
    expect(ia).toBeDefined();
    expect(r.passedControls.map((c) => c.controlId)).toContain('AIMS-5.3');
  });
});

describe('parameter enforcement (review fix M1, M2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parameterEnforcement, parameterCatalog } = require('./parameter-enforcement');

  it('marks parameters that no control or platform feature reads as not enforced', () => {
    expect(parameterEnforcement('incidentReportHours')).toEqual({ enforced: false, enforcedBy: [] });
    expect(parameterEnforcement('fairnessRatioMin').enforced).toBe(false);
    expect(parameterEnforcement('driftRecencyDays')).toMatchObject({ enforced: true, enforcedBy: expect.arrayContaining(['CTL-MON-01']) });
    expect(parameterEnforcement('euHighRiskDomains').enforced).toBe(true);
    expect(parameterCatalog().map((p: any) => p.name)).toContain('incidentReportHours');
  });

  it('the EU pack uses the AI Act Art. 73 deadline, not GDPR', () => {
    const eu = BUILT_IN_PACKS.find((p) => p.id === 'eu-ai-act')!;
    expect(eu.parameters.incidentReportHours).toBe(360);
  });
});
