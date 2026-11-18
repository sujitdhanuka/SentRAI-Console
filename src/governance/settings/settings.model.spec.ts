/** E1.2 settings model: defaults, validation, pack floors, matrix bands, diffs, tiers. */
import { RiskLevel } from '../../common/enums';
import {
  applyChanges,
  applyFloors,
  bandFor,
  BANDS_3X3,
  defaultSettings,
  diffSettings,
  floorsFor,
  gateTierOf,
  mergeSettings,
  validateSettings,
} from './settings.model';

describe('governance settings defaults (design §4.1)', () => {
  const d = defaultSettings();
  it('5x5 with four bands, block CRITICAL and warn HIGH, baseline packs only', () => {
    expect(d.scoringMatrix).toBe('5x5');
    expect(d.bands.map((b) => [b.name, b.min, b.max])).toEqual([['LOW', 1, 4], ['MEDIUM', 5, 9], ['HIGH', 10, 16], ['CRITICAL', 17, 25]]);
    expect(d.gateMode).toEqual({ LOW: 'OFF', MEDIUM: 'OFF', HIGH: 'WARN', CRITICAL: 'BLOCK' });
    expect(d.enabledPacks).toEqual([]);
    expect(validateSettings(d)).toEqual([]);
  });
  it('ISO competence and awareness are light records; other people-side items are customer responsibility', () => {
    expect(d.peopleItems.competence.mode).toBe('LIGHT_RECORD');
    expect(d.peopleItems.awareness.mode).toBe('LIGHT_RECORD');
    for (const k of ['training', 'team_diversity', 'stakeholder_panels', 'expert_input']) expect(d.peopleItems[k].mode).toBe('CUSTOMER');
  });
  it('HIGH and CRITICAL acceptances need the accountable official (executive sign-off, E1.9)', () => {
    expect(d.appetite.approvers.HIGH).toContain('ACCOUNTABLE_OFFICIAL');
    expect(d.appetite.approvers.CRITICAL).toEqual(['ACCOUNTABLE_OFFICIAL']);
  });
});

describe('validation', () => {
  it('3x3 with its three preset bands is valid; bands must reach 9', () => {
    const s = mergeSettings(defaultSettings(), { scoringMatrix: '3x3', bands: BANDS_3X3 });
    delete s.appetite.approvers.CRITICAL;
    for (const k of Object.keys(s.appetite.ceilings)) s.appetite.ceilings[k] = 4;
    expect(validateSettings(s)).toEqual([]);
    const bad = { ...s, bands: [{ name: 'LOW', min: 1, max: 4 }] };
    expect(validateSettings(bad).map((p) => p.message).join()).toMatch(/top band must end at 9/);
  });
  it('rejects gaps, overlaps, bad gate modes, unknown packs and out-of-range ceilings', () => {
    const s = defaultSettings();
    s.bands = [{ name: 'LOW', min: 1, max: 3 }, { name: 'MEDIUM', min: 6, max: 9 }, { name: 'HIGH', min: 9, max: 25 }];
    (s.gateMode as any).HIGH = 'MAYBE';
    s.enabledPacks = ['au-dta-9'];
    s.appetite.ceilings.FAIRNESS = 40;
    const msgs = validateSettings(s).map((p) => `${p.field}: ${p.message}`).join('\n');
    expect(msgs).toMatch(/score 4 is not in any band/);
    expect(msgs).toMatch(/overlap/);
    expect(msgs).toMatch(/gateMode.HIGH/);
    expect(msgs).toMatch(/au-dta-9 is not an available region pack/);
    expect(msgs).toMatch(/ceilings.FAIRNESS: must be between 1 and 25/);
  });
  it('every band needs an approver', () => {
    const s = defaultSettings();
    s.appetite.approvers = { LOW: ['OWNER'] };
    expect(validateSettings(s).map((p) => p.field)).toEqual(expect.arrayContaining(['appetite.approvers.MEDIUM', 'appetite.approvers.CRITICAL']));
  });
});

describe('pack floors', () => {
  it('a setting cannot be looser than an enabled pack, and the error names the pack', () => {
    const s = defaultSettings();
    s.enabledPacks = ['rbi-free-ai'];
    s.appetite.parameters = { incidentReportHours: 48 };
    s.appetite.requiredAuditType.HIGH = 'THIRD_PARTY';
    s.appetite.requiredAuditType.CRITICAL = 'THIRD_PARTY';
    const p = validateSettings(s);
    expect(p).toEqual([{ field: 'appetite.parameters.incidentReportHours', message: expect.stringContaining('rbi-free-ai'), pack: 'rbi-free-ai' }]);
    s.appetite.parameters = { incidentReportHours: 12 }; // stricter is fine
    expect(validateSettings(s)).toEqual([]);
  });
  it('with RBI enabled a HIGH model’s third-party audit stays mandatory', () => {
    const s = defaultSettings();
    s.enabledPacks = ['rbi-free-ai'];
    const p = validateSettings(s);
    expect(p.map((x) => x.field)).toEqual(['appetite.requiredAuditType.HIGH', 'appetite.requiredAuditType.CRITICAL']);
    expect(p[0].message).toMatch(/THIRD_PARTY while rbi-free-ai is enabled/);
    expect(validateSettings(applyFloors(s))).toEqual([]);
  });
  it('the baseline alone sets no floors; floors combine strictest across region packs', () => {
    expect(floorsFor([])).toEqual({});
    expect(floorsFor(['eu-ai-act', 'rbi-free-ai']).incidentReportHours).toEqual({ value: 24, packs: ['rbi-free-ai'] });
    expect(floorsFor(['eu-ai-act']).incidentReportHours).toEqual({ value: 360, packs: ['eu-ai-act'] });
  });
});

describe('helpers', () => {
  it('bands map scores, tiers map risk levels', () => {
    expect(bandFor(4, defaultSettings().bands)).toBe('LOW');
    expect(bandFor(10, defaultSettings().bands)).toBe('HIGH');
    expect(bandFor(17, defaultSettings().bands)).toBe('CRITICAL');
    expect(bandFor(6, BANDS_3X3)).toBe('HIGH');
    expect(gateTierOf(RiskLevel.PROHIBITED)).toBe('CRITICAL');
    expect(gateTierOf(RiskLevel.LIMITED)).toBe('MEDIUM');
  });
  it('diff lists field-level changes; merge replaces lists and merges objects', () => {
    const a = defaultSettings();
    const b = mergeSettings(a, { gateMode: { HIGH: 'BLOCK' } as any, enabledPacks: ['eu-ai-act'] });
    expect(b.gateMode).toEqual({ LOW: 'OFF', MEDIUM: 'OFF', HIGH: 'BLOCK', CRITICAL: 'BLOCK' });
    expect(diffSettings(a, b)).toEqual([
      { field: 'gateMode.HIGH', from: 'WARN', to: 'BLOCK' },
      { field: 'enabledPacks', from: [], to: ['eu-ai-act'] },
    ]);
  });
});

describe('applyChanges (carry-forward over scheduled versions)', () => {
  it('sets dotted fields, replaces lists, deletes on null, and never mutates its input', () => {
    const a = defaultSettings();
    const b = applyChanges(a, [
      { field: 'gateMode.HIGH', to: 'BLOCK' },
      { field: 'enabledPacks', to: ['eu-ai-act'] },
      { field: 'appetite.parameters.driftRecencyDays', to: 14 },
    ]);
    expect(b.gateMode.HIGH).toBe('BLOCK');
    expect(b.enabledPacks).toEqual(['eu-ai-act']);
    expect(b.appetite.parameters.driftRecencyDays).toBe(14);
    expect(a.gateMode.HIGH).toBe('WARN');
    const c = applyChanges(b, [{ field: 'appetite.parameters.driftRecencyDays', to: null }]);
    expect('driftRecencyDays' in c.appetite.parameters).toBe(false);
  });
  it('replaying a diff onto a later version keeps that version\'s own fields', () => {
    const base = defaultSettings();
    const scheduled = mergeSettings(base, { scoringMatrix: '3x3', bands: BANDS_3X3 } as any);
    const immediate = mergeSettings(base, { gateMode: { MEDIUM: 'WARN' } as any });
    const carried = applyChanges(scheduled, diffSettings(base, immediate));
    expect(carried.scoringMatrix).toBe('3x3');
    expect(carried.gateMode.MEDIUM).toBe('WARN');
  });
});
