/**
 * E1.1 golden compatibility: with the pack engine on, every check the
 * validators print is identical (code, name, pass/fail, mandatory, evidence,
 * gap, NOT ASSESSED marker, risk tier) to the legacy validators under the same
 * Phase 0 flags. Run over every golden fixture and over each fixture at every
 * risk tier, so mandatory rules and tier classifiers are exercised too.
 */
import golden from '../../../test/fixtures/compliance-golden.json';
import { COMPLIANCE_FIXTURES } from '../../../test/fixtures/compliance-fixtures';
import { ModelType, RiskLevel } from '../../common/enums';
import { FeatureFlags } from '../../common/feature-flags';
import { validateEuAiAct, validateIso42001, validateNistRmf } from '../../compliance/frameworks.validator';
import { validateSutrasCompliance } from '../../compliance/sutras.validator';

const combos: Array<Omit<FeatureFlags, 'packEngine'>> = [
  { governanceV2: true, redTeamIntervals: false, bcpDrills: false, nistPrivacy: false },
  { governanceV2: true, redTeamIntervals: true, bcpDrills: false, nistPrivacy: false },
  { governanceV2: true, redTeamIntervals: false, bcpDrills: true, nistPrivacy: true },
  { governanceV2: true, redTeamIntervals: true, bcpDrills: true, nistPrivacy: true },
];
const DAY = 86_400_000;

const variants = COMPLIANCE_FIXTURES.flatMap((f) => [
  f,
  ...[RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL, RiskLevel.LIMITED].map((riskLevel) => ({
    ...f,
    id: `${f.id}@${riskLevel}`,
    entry: { ...f.entry, riskLevel },
  })),
  { ...f, id: `${f.id}+genai`, entry: { ...f.entry, modelType: ModelType.GENERATIVE_AI, functionalArea: 'support_chatbot' } },
  { ...f, id: `${f.id}+drill`, ctx: { ...f.ctx, bcpDrillLastConducted: new Date(Date.now() - 20 * DAY) } },
  { ...f, id: `${f.id}+old-drill`, ctx: { ...f.ctx, bcpDrillLastConducted: new Date(Date.now() - 500 * DAY) } },
  { ...f, id: `${f.id}+eu-domains`, ctx: { ...f.ctx, euHighRiskDomains: ['general_purpose'] } },
]);

describe('E1.1 pack engine reproduces the validators exactly', () => {
  for (const flags of combos) {
    const label = Object.entries(flags).filter(([, v]) => v).map(([k]) => k).join('+');
    const legacy: FeatureFlags = { ...flags, packEngine: false };
    const packed: FeatureFlags = { ...flags, packEngine: true };
    it.each(variants.map((v) => [v.id, v] as const))(`[${label}] %s`, (_id, v) => {
      for (const fn of [validateNistRmf, validateEuAiAct, validateIso42001]) {
        expect(fn(v.entry, { ...v.ctx, flags: packed })).toEqual(fn(v.entry, { ...v.ctx, flags: legacy }));
      }
      expect(validateSutrasCompliance(v.entry, { ...v.ctx, flags: packed })).toEqual(
        validateSutrasCompliance(v.entry, { ...v.ctx, flags: legacy }),
      );
    });
  }

  it('matches the E0.1 golden baseline pass/fail apart from the documented Phase 0 code corrections', () => {
    // Golden is the pre-Phase-0 flags-off output; Phase 0 relabelled codes but kept every verdict,
    // except AIMS-8.2 (now AIMS-8.4, NOT ASSESSED). Compare verdict sequences per framework.
    const flags: FeatureFlags = { governanceV2: true, redTeamIntervals: false, bcpDrills: false, nistPrivacy: false, packEngine: true };
    for (const fx of COMPLIANCE_FIXTURES) {
      const g = (golden as any[]).find((x) => x.id === fx.id);
      const ctx = { ...fx.ctx, flags };
      const verdicts = (r: { checks: Array<{ passed: boolean; mandatory: boolean }> }) => r.checks.map((c) => [c.passed, c.mandatory]);
      const gv = (list: any[]) => list.map((c) => [c.passed, c.mandatory]);
      expect(verdicts(validateNistRmf(fx.entry, ctx))).toEqual(gv(g.nist));
      expect(verdicts(validateEuAiAct(fx.entry, ctx))).toEqual(gv(g.eu));
      const iso = validateIso42001(fx.entry, ctx).checks;
      const isoGolden = g.iso.filter((c: any) => c.code !== 'AIMS-8.2');
      expect(iso.filter((c) => c.controlCode !== 'AIMS-8.4').map((c) => [c.passed, c.mandatory])).toEqual(gv(isoGolden));
      expect(validateSutrasCompliance(fx.entry, { flags }).checks.map((c) => [c.passed, c.mandatory])).toEqual(gv(g.sutras));
    }
  });
});
