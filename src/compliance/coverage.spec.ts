import { flagSet, PHASE3_FLAGS } from '../common/feature-flags';
import { getControl } from '../governance/controls/control-library';
import { BUILT_IN_PACKS } from '../governance/packs/pack-loader';
import { coverageMode, coverageSummary, getCoverage } from './coverage.data';

const ALL = flagSet(true);
const byId = (flags = ALL) => Object.fromEntries(getCoverage(flags).map((f) => [f.id, f]));

describe('coverage disclosure with the framework pack engine on', () => {
  it('lists exactly the clauses each pack in force serves, and nothing else', () => {
    for (const f of getCoverage(ALL)) {
      const def = BUILT_IN_PACKS.find((d) => d.legacyId === f.id)!;
      expect(def).toBeDefined();
      const served = def.clauses.filter((c) => !c.flag || ALL[c.flag]).map((c) => `${c.code}|${c.name}`).sort();
      const listed = [...f.evaluated, ...(f.notAssessed ?? [])].map((c) => `${c.code}|${c.name}`).sort();
      expect(listed).toEqual(served);
      for (const c of f.evaluated) {
        const clause = def.clauses.find((x) => x.code === c.code && x.name === c.name)!;
        expect(c.scope).toBe(getControl(clause.control)!.scope === 'ORG' ? 'organisation' : 'model');
        expect(Boolean(c.advisory)).toBe(clause.mandatory === false);
      }
      expect(f.statement).not.toMatch(/\{\w+\}/);
      expect(f.universe.covered).toBeLessThanOrEqual(f.universe.total);
    }
  });

  it('reports a check as NOT ASSESSED, not evaluated, while the epic behind its evidence is off', () => {
    const iso = byId(flagSet(true, { impactAssessment: false })).iso_42001;
    expect(iso.evaluated.map((c) => c.code)).not.toContain('AIMS-8.4');
    expect(iso.notAssessed!.map((c) => c.code)).toEqual(['AIMS-8.4']);
    expect(iso.statement).toContain('AIMS-8.4 is reported NOT ASSESSED');
    expect(byId().iso_42001.evaluated.map((c) => c.code)).toContain('AIMS-8.4');
  });

  it('shows the opt-in region packs only while their flag is on, and says they are opt-in', () => {
    expect(byId(flagSet(true, { auPack: false, usKit: false })).au_dta).toBeUndefined();
    expect(byId(flagSet(true, { auPack: false, usKit: false })).us_2026).toBeUndefined();
    expect(byId().au_dta.availability).toMatch(/^Opt-in/);
    expect(byId().us_2026.availability).toMatch(/^Opt-in/);
    expect(byId().nist_ai_rmf.availability).toBeUndefined();
  });

  it('hides Phase 3 checks while Phase 3 is off', () => {
    const off = Object.fromEntries(PHASE3_FLAGS.map((f) => [f, false]));
    const codes = getCoverage(flagSet(true, off)).flatMap((f) => f.evaluated.map((c) => c.code));
    expect(codes).not.toContain('MEASURE-2.12');
    expect(codes).not.toContain('SUTRA-7-ENERGY');
    expect(codes).not.toContain('AIMS-A.6.2.6');
    expect(getCoverage(ALL).flatMap((f) => f.evaluated.map((c) => c.code))).toContain('MEASURE-2.12');
  });

  it('does not overstate energy tracking: readings are recorded, not sampled', () => {
    const energy = getCoverage(ALL).flatMap((f) => f.evaluated).filter((c) => ['MEASURE-2.12', 'SUTRA-7-ENERGY', 'AIMS-A.5.5'].includes(c.code));
    expect(energy.length).toBe(3);
    for (const c of energy) expect(c.note).toMatch(/does not sample GPUs or attribute power to models automatically/);
  });

  it('counts RBI recommendations from the clauses, with Rec 21 only while BCP drills are on', () => {
    expect(byId().rbi_free_ai.statement).toMatch(/Recs [\d, ]*21/);
    expect(byId(flagSet(true, { bcpDrills: false })).rbi_free_ai.statement).not.toMatch(/\b21\b/);
  });

  it('says which evaluation path the deployment runs', () => {
    expect(coverageSummary(ALL).mode).toBe('packs');
    expect(coverageSummary(flagSet(false)).mode).toBe('validators');
    expect(coverageMode(flagSet(false)).description).toMatch(/built-in validators/);
  });
});

describe('depth labels follow the reviewed implementation status and the flags', () => {
  it('with every flag on: every framework, the EU AI Act included, is deep', () => {
    const f = byId();
    for (const id of ['nist_ai_rmf', 'iso_42001', 'rbi_free_ai', 'au_dta', 'us_2026', 'eu_ai_act']) expect(f[id].depth).toBe('deep');
    expect(f.eu_ai_act.implementation).toMatchObject({ implemented: 45, partial: 0, gap: 0, notApplicable: 14, applicable: 45 });
    expect(f.nist_ai_rmf.implementation).toMatchObject({ implemented: 66, partial: 6, applicable: 72 });
    expect(f.iso_42001.implementation).toMatchObject({ implemented: 63, partial: 2, applicable: 65 });
    expect(f.rbi_free_ai.implementation).toMatchObject({ implemented: 19, applicable: 20, notApplicable: 13 });
  });

  it('the EU AI Act stays partial and claims no workspace duties while GOV_E5_1_EU_ACT is off', () => {
    const eu = byId(flagSet(true, { euAiAct: false })).eu_ai_act;
    expect(eu.depth).toBe('partial');
    expect(eu.statement).toMatch(/off in this deployment/);
    expect(eu.operational).toEqual([]);
    expect(eu.evaluated.map((c) => c.code)).not.toContain('Art-5');
    const on = byId().eu_ai_act;
    expect(on.evaluated.map((c) => c.code)).toEqual(expect.arrayContaining(['Art-5', 'Art-6', 'Art-43', 'Art-49', 'Art-73', 'Art-86']));
    expect(on.statement).toMatch(/operator role/);
    expect((on.operational ?? []).join(' ')).toMatch(/2, 10 and 15-day/);
  });

  it('a requirement counts as implemented only while every flag it needs is on', () => {
    const off = Object.fromEntries(PHASE3_FLAGS.map((k) => [k, false]));
    const nist = byId(flagSet(true, off)).nist_ai_rmf.implementation!;
    expect(nist.implemented).toBeLessThan(66);
    expect(nist.heldBackByFlags).toBeGreaterThan(0);
    const minimal = byId(flagSet(false, { governanceV2: true, packEngine: true })).nist_ai_rmf;
    expect(minimal.implementation!.implemented).toBe(22);
    expect(minimal.depth).toBe('partial');
  });

  it('validator mode keeps its stated labels and carries no implementation figures', () => {
    const f = byId(flagSet(false));
    expect(f.nist_ai_rmf.depth).toBe('partial');
    expect(f.rbi_free_ai.depth).toBe('deep');
    expect(f.nist_ai_rmf.implementation).toBeUndefined();
  });
});

describe('coverage disclosure with the built-in validators', () => {
  it('names the EU minimal-risk entry by the code the validator prints and says it is not a check', () => {
    const eu = byId(flagSet(false)).eu_ai_act;
    const min = eu.evaluated.find((c) => c.code === 'Art-Minimal')!;
    expect(min.note).toMatch(/no obligation is checked/);
    expect(eu.evaluated.map((c) => c.code)).not.toContain('Art-Min');
  });
});
