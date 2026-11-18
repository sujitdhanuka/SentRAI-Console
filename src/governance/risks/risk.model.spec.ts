/** E1.3 risk rules and E1.4 questionnaire rules. */
import { BANDS_3X3, defaultSettings, mergeSettings } from '../settings/settings.model';
import { checkAnswers, defaultQuestionnaires, deriveFlags } from '../impact/questionnaires';
import { acceptanceRole, band, catalogueFor, reviewIntervalDays, STARTER_CATALOGUE, validateRating, withinAppetite } from './risk.model';

describe('risk scoring and bands', () => {
  const five = defaultSettings();
  const three = mergeSettings(defaultSettings(), { scoringMatrix: '3x3', bands: BANDS_3X3 });

  it('5x5: bands Low 1–4, Medium 5–9, High 10–16, Critical 17–25', () => {
    expect(band({ l: 2, i: 2 }, five)).toBe('LOW');
    expect(band({ l: 3, i: 3 }, five)).toBe('MEDIUM');
    expect(band({ l: 4, i: 4 }, five)).toBe('HIGH');
    expect(band({ l: 5, i: 4 }, five)).toBe('CRITICAL');
  });
  it('3x3: three bands', () => {
    expect(band({ l: 1, i: 2 }, three)).toBe('LOW');
    expect(band({ l: 2, i: 2 }, three)).toBe('MEDIUM');
    expect(band({ l: 3, i: 3 }, three)).toBe('HIGH');
  });
  it('ratings must fit the matrix', () => {
    expect(validateRating({ l: 5, i: 5 }, '5x5')).toBeNull();
    expect(validateRating({ l: 4, i: 1 }, '3x3')).toMatch(/1 to 3 on a 3x3/);
    expect(validateRating({ l: 0, i: 1 }, '5x5')).toMatch(/likelihood/);
    expect(validateRating({ l: 2.5, i: 1 }, '5x5')).toMatch(/whole number/);
  });
  it('review interval shortens with the residual band', () => {
    expect(reviewIntervalDays('CRITICAL')).toBe(90);
    expect(reviewIntervalDays('HIGH')).toBe(180);
    expect(reviewIntervalDays('LOW')).toBe(365);
  });
  it('appetite ceilings are per category', () => {
    const s = defaultSettings();
    s.appetite.ceilings.FAIRNESS = 4;
    expect(withinAppetite('FAIRNESS', { l: 2, i: 2 }, s)).toBe(true);
    expect(withinAppetite('FAIRNESS', { l: 1, i: 5 }, s)).toBe(false);
    expect(withinAppetite('SECURITY', { l: 3, i: 3 }, s)).toBe(true);
  });
});

describe('acceptance by the approver the appetite names', () => {
  const s = defaultSettings();
  it('HIGH and CRITICAL need the accountable official by default (executive sign-off); CISO may accept HIGH', () => {
    expect(acceptanceRole('CRITICAL', s, { role: 'CISO' }, false)).toBeNull();
    expect(acceptanceRole('CRITICAL', s, { role: 'OWNER' }, true)).toBe('ACCOUNTABLE_OFFICIAL');
    expect(acceptanceRole('HIGH', s, { role: 'CISO' }, false)).toBe('CISO');
    expect(acceptanceRole('HIGH', s, { role: 'OWNER' }, false)).toBeNull();
    expect(acceptanceRole('MEDIUM', s, { role: 'OWNER' }, false)).toBe('OWNER');
    expect(acceptanceRole('LOW', s, { role: 'VIEWER' }, false)).toBeNull();
  });
});

describe('starter catalogue', () => {
  it('has the 11 design categories', () => {
    expect(new Set(STARTER_CATALOGUE.map((c) => c.category)).size).toBe(11);
  });
  it('filters by use: a credit model gets fairness and model-risk, a chatbot gets third-party and energy', () => {
    const credit = catalogueFor({ functionalArea: 'credit_underwriting', modelType: 'MACHINE_LEARNING' }, []).map((c) => c.category);
    expect(credit).toEqual(expect.arrayContaining(['FAIRNESS', 'MODEL_RISK']));
    expect(credit).not.toContain('THIRD_PARTY');
    const bot = catalogueFor({ functionalArea: 'customer_support_chatbot', modelType: 'GENERATIVE_AI' }, []).map((c) => c.category);
    expect(bot).toEqual(expect.arrayContaining(['THIRD_PARTY', 'ENVIRONMENT']));
    expect(bot).not.toContain('FAIRNESS');
  });
});

describe('impact assessment questionnaires', () => {
  it('ISO always applies; EU FRIA with the EU pack; AU and US by primary jurisdiction', () => {
    expect(defaultQuestionnaires([], 'INTL')).toEqual(['iso-42001']);
    expect(defaultQuestionnaires(['eu-ai-act'], 'INTL')).toEqual(['iso-42001', 'eu-fria']);
    expect(defaultQuestionnaires([], 'AU')).toEqual(['iso-42001', 'au-dta']);
    expect(defaultQuestionnaires([], 'US')).toEqual(['iso-42001', 'us-m25-21', 'us-sr26-2']);
  });
  it('drafts may be partial; finalising needs every required answer of the right type', () => {
    expect(checkAnswers(['iso-42001'], { 'iso-42001': { purpose: 'x' } }, false)).toEqual([]);
    expect(checkAnswers(['iso-42001'], { 'iso-42001': { purpose: 'x' } }, true).length).toBeGreaterThan(3);
    expect(checkAnswers(['iso-42001'], { 'iso-42001': { severity: 'EXTREME' } }, false)[0]).toMatch(/one of LOW, MEDIUM, HIGH/);
    expect(checkAnswers(['iso-42001'], { 'eu-fria': {} }, false)[0]).toMatch(/not part of this assessment/);
  });
  it('derives in-scope (AU), high-impact (M-25-21) and materiality (SR 26-2, the higher of exposure and purpose)', () => {
    const f = deriveFlags(['iso-42001', 'au-dta', 'us-m25-21', 'us-sr26-2'], {
      'au-dta': { influences_decisions: false, public_interaction: true },
      'us-m25-21': { principal_basis: false, presumed_category: false },
      'us-sr26-2': { exposure: 'MEDIUM', purpose_criticality: 'HIGH' },
    });
    expect(f).toEqual({ inScope: true, highImpact: false, materiality: 'HIGH' });
    expect(deriveFlags(['iso-42001'], {})).toEqual({ inScope: null, highImpact: null, materiality: null });
  });
});
