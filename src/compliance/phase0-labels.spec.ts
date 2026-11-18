/**
 * Phase 0 (governance plan E0.2–E0.5): every printed code is a real code, the
 * corrected labels are in place, flagged checks only run behind their flag,
 * and with flags off every check passes or fails exactly as it did before
 * (the E0.1 golden baseline), apart from the documented AIMS impact change.
 */
import golden from '../../test/fixtures/compliance-golden.json';
import { COMPLIANCE_FIXTURES } from '../../test/fixtures/compliance-fixtures';
import { ModelLifecycleStage, ModelType, RiskLevel, SutraAlignment } from '../common/enums';
import { FeatureFlags } from '../common/feature-flags';
import { AIModelEntry, redTeamIntervalDays } from '../domain/model-inventory';
import { COVERAGE, getCoverage } from './coverage.data';
import { isoCodeExists, nistCodeExists, RBI_FREE_AI_RECOMMENDATIONS } from './framework-codes';
import {
  frameworkBlockingGaps,
  frameworkOverallPass,
  frameworkReportAsDict,
  validateEuAiAct,
  validateIso42001,
  validateNistRmf,
} from './frameworks.validator';
import { ISO42001Plugin } from './plugins/iso-42001.plugin';
import { validateSutrasCompliance } from './sutras.validator';

const OFF: FeatureFlags = { governanceV2: false, redTeamIntervals: false, bcpDrills: false, nistPrivacy: false, packEngine: false };
const ON: FeatureFlags = { governanceV2: true, redTeamIntervals: true, bcpDrills: true, nistPrivacy: true, packEngine: false };
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

function entry(overrides: Partial<AIModelEntry> = {}): AIModelEntry {
  const now = new Date();
  return {
    modelId: 'm', name: 'M', modelType: ModelType.MACHINE_LEARNING, functionalArea: 'credit_underwriting',
    useCaseDescription: 'Scores SME credit applications for underwriters.', targetCustomerSegments: ['sme'],
    riskLevel: RiskLevel.HIGH, lifecycleStage: ModelLifecycleStage.DEPLOYED, ownerTeam: 'Credit Risk',
    developedBy: 'internal', deploymentDate: daysAgo(100), dependencies: ['xgboost'], performanceBenchmarks: [],
    sutrasAlignment: [SutraAlignment.FAIRNESS, SutraAlignment.EXPLAINABILITY], humanOversightRequired: true,
    autonomousScope: null, boardPolicyRef: 'POL-1', lastRedTeamDate: daysAgo(10), nextAuditDue: new Date(Date.now() + 30 * DAY),
    grievanceCount: 0, grievanceResolutionNotes: '', sourceRef: 'repo', registeredAt: now, updatedAt: now,
    isActive: true, projectId: null,
    evidenceArtifacts: [{ type: 'bias_test', ref: 'doc', added_at: now.toISOString() }],
    ...overrides,
  };
}
const healthy = { ledgerEventCount: 3, driftReportCount: 2, lastDriftAt: daysAgo(1), overdueIncidentCount: 0, bcpConfigured: true };

describe('Phase 0 labels: every printed code is a real code', () => {
  const all = COMPLIANCE_FIXTURES.flatMap(({ entry: e, ctx }) => [
    ...validateNistRmf(e, { ...ctx, flags: ON }).checks.map((c) => ['nist', c.controlCode] as const),
    ...validateNistRmf(e, { ...ctx, flags: OFF }).checks.map((c) => ['nist', c.controlCode] as const),
    ...validateIso42001(e, { ...ctx, flags: ON }).checks.map((c) => ['iso', c.controlCode] as const),
  ]);

  it.each([...new Set(all.map(([f, c]) => `${f}|${c}`))])('%s exists in the official code list', (key) => {
    const [fw, code] = key.split('|');
    expect(fw === 'nist' ? nistCodeExists(code) : isoCodeExists(code)).toBe(true);
  });

  it('ISO plugin control IDs exist in the ISO code list', () => {
    const r = new ISO42001Plugin().evaluate({ risk_level: 'HIGH', owner_team: 'x', board_policy_ref: 'p', use_case_description: 'u', lifecycle_stage: 'DEPLOYED' });
    for (const c of r.passedControls) expect(isoCodeExists(c.controlId)).toBe(true);
  });

  it('coverage page codes are real codes and match what the validators print', () => {
    for (const fw of getCoverage(ON)) {
      for (const c of fw.evaluated) {
        if (fw.id === 'nist_ai_rmf') expect(nistCodeExists(c.code)).toBe(true);
        if (fw.id === 'iso_42001') expect(isoCodeExists(c.code)).toBe(true);
        if (fw.id === 'rbi_free_ai' && c.code.startsWith('REC-')) {
          expect(RBI_FREE_AI_RECOMMENDATIONS).toContain(Number(c.code.slice(4)));
        }
      }
    }
    const printed = (flags: FeatureFlags) => ({
      nist: new Set(validateNistRmf(entry(), { ...healthy, flags }).checks.map((c) => c.controlCode)),
      iso: new Set(validateIso42001(entry(), { ...healthy, flags }).checks.filter((c) => !c.notAssessed).map((c) => c.controlCode)),
    });
    for (const flags of [ON, OFF]) {
      const cov = getCoverage(flags);
      const p = printed(flags);
      expect(new Set(cov.find((f) => f.id === 'nist_ai_rmf')!.evaluated.map((c) => c.code))).toEqual(p.nist);
      expect(new Set(cov.find((f) => f.id === 'iso_42001')!.evaluated.map((c) => c.code))).toEqual(p.iso);
    }
  });

  it('RBI coverage no longer misuses Recs 16, 20 and 24', () => {
    const rbi = getCoverage(OFF).find((f) => f.id === 'rbi_free_ai')!;
    const recs = Object.fromEntries(rbi.evaluated.filter((c) => c.code.startsWith('REC-')).map((c) => [c.code, c.name]));
    expect(Object.keys(recs).sort()).toEqual(['REC-14', 'REC-20']);
    expect(recs['REC-20']).toMatch(/red-team/i);
    expect(rbi.statement).toContain('two are checked per model');
    expect(rbi.statement).not.toMatch(/\{\w+\}/);
    expect(getCoverage(ON).find((f) => f.id === 'rbi_free_ai')!.evaluated.map((c) => c.code)).toContain('REC-21');
  });

  it('flagged coverage entries are hidden while their flag is off', () => {
    const codes = getCoverage(OFF).flatMap((f) => f.evaluated.map((c) => c.code));
    expect(codes).not.toContain('MEASURE-2.10');
    expect(codes).not.toContain('REC-21');
    expect(COVERAGE.find((f) => f.id === 'nist_ai_rmf')!.evaluated.some((c) => c.code === 'MEASURE-2.10')).toBe(true);
  });

  it('Sutra gap text no longer cites semi-annual red teaming or Rec 24 for explainability', () => {
    const r = validateSutrasCompliance(entry({ lastRedTeamDate: null, evidenceArtifacts: [], sutrasAlignment: [] }), { flags: OFF });
    const gaps = r.checks.map((c) => c.gap).join(' ');
    expect(gaps).not.toMatch(/semi-annual/i);
    expect(gaps).not.toMatch(/REC 24/);
    expect(gaps).toMatch(/proportionate to risk/);
  });
});

describe('Phase 0 labels: ISO impact assessment is NOT ASSESSED', () => {
  it('never passes on use-case text and never blocks', () => {
    const r = validateIso42001(entry({ useCaseDescription: 'x'.repeat(500) }), { ...healthy, flags: OFF });
    const ia = r.checks.find((c) => c.controlCode === 'AIMS-8.4')!;
    expect(ia).toMatchObject({ passed: false, mandatory: false, notAssessed: true });
    expect(frameworkBlockingGaps(r).join(' ')).not.toMatch(/impact assessment/i);
    expect(frameworkReportAsDict(r).checks.find((c: any) => c.control_code === 'AIMS-8.4').not_assessed).toBe(true);
    expect(frameworkReportAsDict(r).checks.find((c: any) => c.control_code === 'AIMS-9.1').not_assessed).toBeUndefined();
  });
});

describe('E0.3 per-tier red-team interval (flagged)', () => {
  it('defaults are HIGH 90, MEDIUM 180, LOW 365; CRITICAL uses HIGH', () => {
    expect(redTeamIntervalDays(RiskLevel.HIGH)).toBe(90);
    expect(redTeamIntervalDays(RiskLevel.CRITICAL)).toBe(90);
    expect(redTeamIntervalDays(RiskLevel.MEDIUM)).toBe(180);
    expect(redTeamIntervalDays(RiskLevel.LOW)).toBe(365);
  });

  const nistRt = (risk: RiskLevel, age: number, flags: FeatureFlags) =>
    validateNistRmf(entry({ riskLevel: risk, lastRedTeamDate: daysAgo(age) }), { ...healthy, flags }).checks.find((c) => c.controlCode === 'MEASURE-2.7')!.passed;

  it.each([
    [RiskLevel.HIGH, 90, true], [RiskLevel.HIGH, 91, false],
    [RiskLevel.MEDIUM, 180, true], [RiskLevel.MEDIUM, 181, false],
    [RiskLevel.LOW, 365, true], [RiskLevel.LOW, 366, false],
  ])('NIST MEASURE-2.7 with the flag on: %s at %i days → %s', (risk, age, ok) => {
    expect(nistRt(risk, age, ON)).toBe(ok);
  });

  it('with the flag off the original 12-month rule applies to every tier', () => {
    expect(nistRt(RiskLevel.HIGH, 200, OFF)).toBe(true);
    expect(nistRt(RiskLevel.HIGH, 365, OFF)).toBe(false);
  });

  it('Sutra 7 applies the HIGH interval only with the flag on', () => {
    const stale = entry({ lastRedTeamDate: daysAgo(120) });
    const safety = (flags: FeatureFlags) => validateSutrasCompliance(stale, { flags, bcpDrillLastConducted: daysAgo(10) }).checks.find((c) => c.sutra === SutraAlignment.SAFETY)!;
    expect(safety(OFF).passed).toBe(true);
    expect(safety(ON).passed).toBe(false);
    expect(safety(ON).gap).toContain('90 days');
  });
});

describe('E0.4 BCP drill check (flagged)', () => {
  const safety = (e: AIModelEntry, drill: Date | null, flags = ON) =>
    validateSutrasCompliance(e, { flags, bcpDrillLastConducted: drill }).checks.find((c) => c.sutra === SutraAlignment.SAFETY)!;

  it('fails a HIGH model with no drill or a stale drill, passes a fresh one', () => {
    expect(safety(entry(), null).passed).toBe(false);
    expect(safety(entry(), null).gap).toMatch(/no passed BCP drill/);
    expect(safety(entry(), daysAgo(366)).passed).toBe(false);
    expect(safety(entry(), daysAgo(366)).gap).toMatch(/REC 21/);
    expect(safety(entry(), daysAgo(365)).passed).toBe(true);
    expect(safety(entry(), daysAgo(20)).evidence).toMatch(/last BCP drill 20 day/);
  });

  it('does not apply to non-HIGH models or with the flag off', () => {
    expect(safety(entry({ riskLevel: RiskLevel.MEDIUM }), null).passed).toBe(true);
    expect(safety(entry(), null, OFF).passed).toBe(true);
  });
});

describe('E0.5 NIST MEASURE-2.10 privacy check (flagged)', () => {
  it('only runs with the flag on and needs dpia evidence', () => {
    const codes = (flags: FeatureFlags, e = entry()) => validateNistRmf(e, { ...healthy, flags }).checks.map((c) => c.controlCode);
    expect(codes(OFF)).not.toContain('MEASURE-2.10');
    expect(codes(ON)).toContain('MEASURE-2.10');
    const without = validateNistRmf(entry(), { ...healthy, flags: ON });
    expect(frameworkOverallPass(without)).toBe(false);
    const withDpia = validateNistRmf(
      entry({ evidenceArtifacts: [{ type: 'dpia', ref: 'doc', added_at: new Date().toISOString() }] }),
      { ...healthy, flags: ON },
    );
    expect(withDpia.checks.find((c) => c.controlCode === 'MEASURE-2.10')!.passed).toBe(true);
  });
});

describe('golden baseline (E0.1): flags off changes labels only', () => {
  const NIST_MAP: Record<string, string> = {
    'GOVERN-1.1': 'GOVERN-2.1', 'GOVERN-1.3': 'GOVERN-1.5', 'MAP-1.2': 'MAP-1.1', 'MAP-1.3': 'MAP-4.1',
    'MEASURE-2.1': 'MEASURE-2.7', 'MEASURE-2.2': 'MEASURE-2.4', 'MANAGE-1.1': 'GOVERN-3.2',
    'MANAGE-1.2': 'MANAGE-2.4', 'MANAGE-1.3': 'MANAGE-4.3',
  };
  const ISO_MAP: Record<string, string> = {
    'AIMS-8.2': 'AIMS-8.4', 'AIMS-8.3': 'AIMS-A.7.5', 'AIMS-10.1': 'AIMS-10.2', 'AIMS-7.2': 'AIMS-5.3', 'AIMS-A.6.2': 'AIMS-A.6.2.7',
  };
  type Row = { code: string; passed: boolean; mandatory: boolean };
  const remap = (rows: Row[], map: Record<string, string>) => rows.map((r) => ({ ...r, code: map[r.code] ?? r.code }));
  const shape = (checks: Array<{ controlCode?: string; sutra?: string; passed: boolean; mandatory: boolean }>) =>
    checks.map((c) => ({ code: (c.controlCode ?? c.sutra)!, passed: c.passed, mandatory: c.mandatory }));

  it.each(COMPLIANCE_FIXTURES.map((f) => [f.id, f] as const))('%s', (id, { entry: e, ctx }) => {
    const base = (golden as any[]).find((g) => g.id === id);
    const c = { ...ctx, flags: OFF };
    expect(shape(validateSutrasCompliance(e, { flags: OFF }).checks)).toEqual(base.sutras);
    expect(shape(validateEuAiAct(e, c).checks)).toEqual(base.eu);
    expect(shape(validateNistRmf(e, c).checks)).toEqual(remap(base.nist, NIST_MAP));
    // The one intended change: the impact check no longer passes on use-case
    // text; it is reported NOT ASSESSED (not passed, not blocking).
    const expectedIso = remap(base.iso, ISO_MAP).map((r) => (r.code === 'AIMS-8.4' ? { ...r, passed: false, mandatory: false } : r));
    expect(shape(validateIso42001(e, c).checks)).toEqual(expectedIso);
  });
});

describe('review fixes (Phase 0 follow-up)', () => {
  it('CRITICAL models get the drill and red-team interval checks with flags on, and keep the old scope with flags off', () => {
    const crit = entry({ riskLevel: RiskLevel.CRITICAL, lastRedTeamDate: null, evidenceArtifacts: [] });
    const safety = (flags: FeatureFlags, e = crit, drill: Date | null = null) =>
      validateSutrasCompliance(e, { flags, bcpDrillLastConducted: drill }).checks.find((c) => c.sutra === SutraAlignment.SAFETY)!;
    expect(safety(OFF).passed).toBe(true); // unchanged flag-off behaviour
    expect(safety(ON).passed).toBe(false);
    expect(safety(ON).gap).toMatch(/CRITICAL risk model with no red-team/);
    expect(safety(ON).gap).toMatch(/no passed BCP drill/);
    const fresh = entry({ riskLevel: RiskLevel.CRITICAL, lastRedTeamDate: daysAgo(10) });
    expect(safety(ON, fresh, daysAgo(5)).passed).toBe(true);
    expect(safety(ON, entry({ riskLevel: RiskLevel.CRITICAL, lastRedTeamDate: daysAgo(100) }), daysAgo(5)).gap).toContain('interval for CRITICAL risk is 90 days');
  });

  it('red-team recency uses the newer of the recorded date and an attached report', () => {
    const e = entry({
      lastRedTeamDate: daysAgo(200),
      evidenceArtifacts: [{ type: 'red_team', ref: 'doc', added_at: daysAgo(5).toISOString() }],
    });
    expect(validateNistRmf(e, { ...healthy, flags: ON }).checks.find((c) => c.controlCode === 'MEASURE-2.7')!.passed).toBe(true);
  });

  it('the coverage page does not claim MEASURE 2.11 and counts distinct subcategories', () => {
    const nist = getCoverage(OFF).find((f) => f.id === 'nist_ai_rmf')!;
    expect(JSON.stringify(nist)).not.toContain('2.11');
    expect(nist.statement).toMatch(/^14 per-model checks cover 13 of the playbook/);
    expect(getCoverage(ON).find((f) => f.id === 'nist_ai_rmf')!.statement).toMatch(/^15 per-model checks cover 14 of/);
    expect(validateNistRmf(entry(), { ...healthy, flags: OFF }).checks.find((c) => c.controlCode === 'MEASURE-2.7')!.name).not.toMatch(/bias/i);
  });

  it('golden with GOVERNANCE_V2 on: only the explained differences appear', () => {
    // Fixtures carry no drill date, so every HIGH/CRITICAL model fails Sutra 7
    // on the drill (E0.4); the 200-day red team breaches the HIGH 90-day
    // interval (E0.3); every model gains MEASURE-2.10, passing only with dpia (E0.5).
    const expected: Record<string, string[]> = {
      'high-governed': ['SUTRA:SAFETY_RESILIENCE_SUSTAINABILITY true->false', '+NIST:MEASURE-2.10=true'],
      'high-ungoverned': ['+NIST:MEASURE-2.10=false'],
      'high-redteam-200d': ['SUTRA:SAFETY_RESILIENCE_SUSTAINABILITY true->false', 'NIST:MEASURE-2.7 true->false', '+NIST:MEASURE-2.10=true'],
      'high-redteam-400d': ['SUTRA:SAFETY_RESILIENCE_SUSTAINABILITY true->false', '+NIST:MEASURE-2.10=true'],
      'high-report-only': ['SUTRA:SAFETY_RESILIENCE_SUSTAINABILITY true->false', '+NIST:MEASURE-2.10=true'],
      'medium-partial': ['+NIST:MEASURE-2.10=false'],
      'medium-short-usecase': ['+NIST:MEASURE-2.10=false'],
      'low-minimal': ['+NIST:MEASURE-2.10=false'],
      'genai-chatbot': ['+NIST:MEASURE-2.10=false'],
      'critical-no-oversight': ['SUTRA:SAFETY_RESILIENCE_SUSTAINABILITY true->false', '+NIST:MEASURE-2.10=false'],
    };
    for (const { id, entry: e, ctx } of COMPLIANCE_FIXTURES) {
      const run = (flags: FeatureFlags) => new Map<string, boolean>([
        ...validateSutrasCompliance(e, { flags }).checks.map((c) => [`SUTRA:${c.sutra}`, c.passed] as [string, boolean]),
        ...validateNistRmf(e, { ...ctx, flags }).checks.map((c, i) => [`NIST:${c.controlCode}#${i}`, c.passed] as [string, boolean]),
        ...validateEuAiAct(e, { ...ctx, flags }).checks.map((c) => [`EU:${c.controlCode}`, c.passed] as [string, boolean]),
        ...validateIso42001(e, { ...ctx, flags }).checks.map((c) => [`ISO:${c.controlCode}`, c.passed] as [string, boolean]),
      ]);
      const off = run(OFF);
      const diffs: string[] = [];
      for (const [k, v] of run(ON)) {
        const key = k.replace(/#\d+$/, '');
        if (!off.has(k)) diffs.push(`+${key}=${v}`);
        else if (off.get(k) !== v) diffs.push(`${key} ${off.get(k)}->${v}`);
      }
      expect({ id, diffs }).toEqual({ id, diffs: expected[id] });
    }
  });
});
