/**
 * Unit tests for the Phase 2 governance rules (E2.1 to E2.8): pure functions
 * only; the API behaviour is covered by the e2e suite.
 */
import { checkNotice, isCreditDecisioning, topFactors, validateReasonCodeMap } from './decisions/decisions.model';
import { normaliseFeature, scanFeatures } from './decisions/proxy-scan';
import { auHighRiskArea } from './disclosures/au-reference';
import { PackRegistry } from './packs/pack-loader';
import { buildXlsx, readXlsxStrings } from './disclosures/xlsx';
import { csvCell, toCsv } from './phase2-util';
import { auditDue, lastRedTeam, redTeamState } from './redteam/redteam-audit.service';
import { matrix, statusOf, trainingFacts } from './training/training.model';
import { independenceProblems } from './validation/validation.service';
import { checkAnswers, classifyLicence, contractGaps, inferComponents, scoreAssessment, VENDOR_CHECKLIST } from './vendors/vendors.model';

const DAY = 86_400_000;

describe('E2.1 Australia', () => {
  it('builds an XLSX the register can be read back from', () => {
    const buf = buildXlsx('Register', ['Use case', 'Risk'], [['Credit <scoring> & "limits"', 'HIGH'], ['=cmd()', 1]]);
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    const strings = readXlsxStrings(buf);
    expect(strings).toEqual(expect.arrayContaining(['Use case', 'Risk', 'Credit <scoring> & "limits"', 'HIGH']));
    // Formula-looking text is stored as text, never as a formula.
    expect(strings.some((s) => s.includes('cmd()'))).toBe(true);
  });

  it('neutralises spreadsheet formula injection in CSV', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(['a', 'b'])).toBe('a; b');
    expect(toCsv([{ key: 'a', label: 'A' }], [{ a: 'x,y' }])).toBe('A\r\n"x,y"\r\n');
  });

  it('maps functional areas to the DTA high-risk areas', () => {
    expect(auHighRiskArea('recruitment_screening')).toBe('recruitment');
    expect(auHighRiskArea('credit_underwriting')).toBeNull();
    expect(auHighRiskArea('marketing_copy')).toBeNull();
  });
});

describe('E2.2 decisions', () => {
  const map = { dti: { code: 'R01', text: 'Debt is high compared with income' }, delinquency: { code: 'R02', text: 'Recent late payments' }, tenure: { code: 'R03', text: 'Short credit history' } };

  it('validates reason-code maps', () => {
    expect(validateReasonCodeMap(map)).toEqual([]);
    expect(validateReasonCodeMap([])).toHaveLength(1);
    expect(validateReasonCodeMap({ f: { code: 'bad code!', text: 'x' } })).toHaveLength(2);
  });

  it('ranks principal factors by absolute contribution, at most four', () => {
    expect(topFactors({ a: 0.1, b: -0.9, c: 0.5, d: 0, e: 0.2, f: 0.3 }).map((f) => f.feature)).toEqual(['b', 'c', 'f', 'e']);
  });

  it('builds a notice from the top factors and flags stated reasons that do not match', () => {
    const factors = [{ feature: 'dti' }, { feature: 'delinquency' }];
    expect(checkNotice(map, factors)).toMatchObject({ consistent: true, reasonCodes: [map.dti, map.delinquency] });
    const bad = checkNotice(map, factors, ['R01', 'R03']);
    expect(bad.consistent).toBe(false);
    expect(bad.mismatches).toEqual(expect.arrayContaining([{ kind: 'NOT_A_TOP_FACTOR', code: 'R03' }, { kind: 'TOP_FACTOR_NOT_STATED', code: 'R02', feature: 'delinquency' }]));
    expect(checkNotice(map, [{ feature: 'unmapped' }]).consistent).toBe(false);
  });

  it('recognises credit decisioning', () => {
    expect(isCreditDecisioning('credit_underwriting')).toBe(true);
    expect(isCreditDecisioning('chatbot')).toBe(false);
  });
});

describe('E2.3 validation independence', () => {
  const validator = { id: 'u1', email: 'val@bank.test', fullName: 'Val Idator', role: 'REVIEWER' };
  it('accepts an unrelated validator', () => {
    expect(independenceProblems(validator, { ownerUserId: 'u2', developedBy: 'internal', ownerTeam: 'Credit' }, 'dev@bank.test')).toEqual([]);
  });
  it('rejects the owner, developer, registrant and viewers', () => {
    expect(independenceProblems(validator, { ownerUserId: 'u1', developedBy: 'internal', ownerTeam: 'Credit' }, null)).toHaveLength(1);
    expect(independenceProblems(validator, { ownerUserId: null, developedBy: 'VAL@bank.test', ownerTeam: 'Credit' }, null)).toHaveLength(1);
    expect(independenceProblems(validator, { ownerUserId: null, developedBy: 'internal', ownerTeam: 'Credit' }, 'val@bank.test')).toHaveLength(1);
    expect(independenceProblems({ ...validator, role: 'VIEWER' }, { ownerUserId: null, developedBy: 'internal', ownerTeam: 'x' }, null)).toHaveLength(1);
  });
});

describe('E2.4 proxy scan', () => {
  it('normalises feature names', () => {
    expect(normaliseFeature('applicantZipCode')).toBe('applicant zip code');
    expect(normaliseFeature('date_of-birth')).toBe('date of birth');
  });
  it('finds prohibited bases and proxies without false positives', () => {
    const hits = scanFeatures(['applicant_zip_code', 'DateOfBirth', 'gender', 'snapshot_date', 'agent_id', 'income', 'marital_status', 'usage', 'page_views']);
    expect(hits.map((h) => h.feature).sort()).toEqual(['DateOfBirth', 'applicant_zip_code', 'gender', 'marital_status']);
    expect(hits.find((h) => h.feature === 'gender')?.kind).toBe('DIRECT');
  });
  it('adds organisation terms', () => {
    expect(scanFeatures(['branch_region'], [{ term: 'branch region', basis: 'national origin' }])).toHaveLength(1);
  });

  it('handles digits, qualifiers and the extra terms', () => {
    const k = (f: string) => scanFeatures([f]).map((h) => `${h.term}:${h.kind}`);
    expect(k('zip5')).toEqual(['zip:PROXY']);
    expect(k('accountAge')).toEqual(['age:PROXY']);
    expect(k('applicant_age')).toEqual(['age:DIRECT']);
    expect(k('job_title')).toEqual([]);
    expect(k('loanTitle')).toEqual([]);
    expect(k('title')).toEqual(['title:PROXY']);
    expect(k('sexOffender')).toEqual([]);
    expect(k('applicant_sex')).toEqual(['sex:DIRECT']);
    for (const f of ['PostCode', 'birth_date', 'year_of_birth', 'isMarried', 'female', 'fname', 'ethnicGroup', 'religiousAffiliation']) expect(k(f).length).toBeGreaterThan(0);
    for (const f of ['email', 'message', 'usage', 'malware_score']) expect(k(f)).toEqual([]);
  });
});

describe('E2.5 vendors', () => {
  const all = (a: string) => Object.fromEntries(VENDOR_CHECKLIST.map((i) => [i.id, a])) as Record<string, any>;
  it('scores the checklist', () => {
    expect(scoreAssessment(all('YES'))).toMatchObject({ score: 100, result: 'SATISFACTORY', gaps: [] });
    expect(scoreAssessment({ ...all('YES'), audit_rights: 'NO' }).result).toBe('UNSATISFACTORY');
    expect(scoreAssessment({ ...all('YES'), audit_rights: 'PARTIAL' }).result).toBe('CONDITIONAL');
    expect(scoreAssessment({ ...all('YES'), ip_indemnity: 'NO', portability_exit: 'NO', testing_before_award: 'NO' }).result).toBe('CONDITIONAL');
    expect(scoreAssessment({ ...all('NA'), audit_rights: 'YES' })).toMatchObject({ score: 100, result: 'SATISFACTORY' });
  });
  it('requires an answer for every item', () => {
    expect(checkAnswers(all('YES'))).toBeNull();
    expect(checkAnswers({ ...all('YES'), audit_rights: 'MAYBE' })).toMatch(/audit_rights/);
    expect(checkAnswers({ ...all('YES'), extra: 'YES' })).toMatch(/Unknown/);
    expect(checkAnswers({ ...all('YES'), audit_rights: 'NA' })).toMatch(/critical/);
    expect(checkAnswers({ ...all('YES'), ip_indemnity: 'NA' })).toBeNull();
  });
  it('lists missing contract terms', () => {
    expect(contractGaps(null)).toHaveLength(6);
    expect(contractGaps({ incident_notification: true, audit_rights: true, data_use_limited: true, model_change_notice: true, portability_exit: true, termination_assistance: true })).toEqual([]);
  });
  it('classifies licences', () => {
    expect(classifyLicence('MIT')).toBe('PERMISSIVE');
    expect(classifyLicence('Apache-2.0')).toBe('PERMISSIVE');
    expect(classifyLicence('AGPL-3.0')).toBe('COPYLEFT');
    expect(classifyLicence('CC-BY-NC-4.0')).toBe('RESTRICTED');
    expect(classifyLicence('llama3-community')).toBe('RESTRICTED');
    expect(classifyLicence('Proprietary')).toBe('PROPRIETARY');
    expect(classifyLicence('')).toBe('UNKNOWN');
    expect(classifyLicence('something-else')).toBe('UNKNOWN');
    expect(classifyLicence('MIT License')).toBe('PERMISSIVE');
    expect(classifyLicence('Apache License 2.0')).toBe('PERMISSIVE');
    expect(classifyLicence('BSL-1.0')).toBe('PERMISSIVE');
    expect(classifyLicence('BSL-1.1')).toBe('RESTRICTED');
    expect(classifyLicence('MIT OR GPL-3.0')).toBe('PERMISSIVE');
    expect(classifyLicence('MIT AND GPL-3.0')).toBe('COPYLEFT');
    expect(classifyLicence('GPL-2.0 WITH Classpath-exception-2.0')).toBe('COPYLEFT');
  });
  it('infers BOM components from the inventory record', () => {
    const c = inferComponents({ developedBy: 'Acme AI', dependencies: ['xgboost==2.0.3', { name: 'gpt-4o', kind: 'model', provider: 'OpenAI', licence: 'Proprietary' }], detectionSignals: ['llm_api_call', 'scoring_logic'] });
    expect(c.map((x) => x.component)).toEqual(['Acme AI', 'xgboost', 'gpt-4o', 'Hosted LLM API']);
    expect(c[1].version).toBe('2.0.3');
    expect(c[2]).toMatchObject({ kind: 'MODEL', provider: 'OpenAI' });
    expect(inferComponents({ developedBy: 'internal', dependencies: [], detectionSignals: [] })).toEqual([]);
    expect(inferComponents({ dependencies: ['@scope/pkg@1.2.0', '@scope/other', 'torch>=2.0', 'lodash@4.17.21'] }).map((x) => [x.component, x.version])).toEqual([
      ['@scope/pkg', '1.2.0'], ['@scope/other', null], ['torch', '>=2.0'], ['lodash', '4.17.21'],
    ]);
  });
});

describe('E2.6 training', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const courses = [
    { id: 'c1', mandatory: true, active: true, targetRoles: [], topic: 'ai_literacy' },
    { id: 'c2', mandatory: true, active: true, targetRoles: ['REVIEWER'], topic: 'policy_ack' },
    { id: 'c3', mandatory: false, active: true, targetRoles: [], topic: 'au_ethics_principles' },
  ];
  const people = [{ id: 'a', role: 'OWNER', isActive: true }, { id: 'b', role: 'REVIEWER', isActive: true }, { id: 'z', role: 'VIEWER', isActive: false }];
  const rec = (courseId: string, userId: string, daysAgo: number, validDays: number | null) => ({
    courseId, userId, completedAt: new Date(now.getTime() - daysAgo * DAY), expiresAt: validDays === null ? null : new Date(now.getTime() - daysAgo * DAY + validDays * DAY),
  });
  it('works out each completion status', () => {
    expect(statusOf(undefined, now)).toBe('MISSING');
    expect(statusOf(rec('c1', 'a', 10, null), now)).toBe('CURRENT');
    expect(statusOf(rec('c1', 'a', 10, 20), now)).toBe('EXPIRING');
    expect(statusOf(rec('c1', 'a', 400, 365), now)).toBe('EXPIRED');
  });
  it('builds the matrix and organisation facts', () => {
    const records = [rec('c1', 'a', 10, 365), rec('c1', 'b', 400, 365), rec('c2', 'b', 5, null), rec('c3', 'a', 1, null)];
    const m = matrix(courses, people, records, now);
    expect(m.map((r) => [r.userId, r.compliant])).toEqual([['a', true], ['b', false]]);
    expect(m[0].cells.map((c) => c.courseId)).toEqual(['c1', 'c3']);
    const f = trainingFacts(courses, people, records, now);
    expect(f).toMatchObject({ mandatoryCourses: 2, staff: 2, compliant: 1, overdue: 1 });
    expect(f.topics.policy_ack).toEqual({ courses: 1, completed: 1, overdue: 0 });
    expect(f.topics.ai_literacy).toEqual({ courses: 1, completed: 1, overdue: 1 });
    expect(f.topics.au_ethics_principles.completed).toBe(1);
  });
  it('counts competence from evidenced courses and awareness from any policy acknowledgement', () => {
    const typed = [
      { id: 'k1', mandatory: true, active: true, targetRoles: [], topic: 'ai_literacy', kind: 'COURSE' },
      { id: 'k2', mandatory: false, active: true, targetRoles: [], topic: 'privacy', kind: 'POLICY_ACK' },
    ];
    const records = [
      { ...rec('k1', 'a', 5, null), evidenceRef: 'LMS-123' },
      { ...rec('k1', 'b', 5, null), evidenceRef: null },
      { ...rec('k2', 'b', 1, null), evidenceRef: 'self-acknowledged' },
    ];
    expect(trainingFacts(typed, people, records, now)).toMatchObject({ competence: 1, awareness: 1 });
  });
});

describe('E2.8 red team and audit rules', () => {
  const base = { lastRedTeamDate: null, evidenceArtifacts: null, redTeamRequiredAt: null, redTeamRequiredReason: null, riskLevel: 'HIGH' } as any;
  it('is satisfied with no rule in play', () => {
    expect(redTeamState(base, false).satisfied).toBe(true);
  });
  it('requires a pre-deploy red team for HIGH when the rule is on', () => {
    expect(redTeamState(base, true)).toMatchObject({ satisfied: false, preDeploy: true });
    expect(redTeamState({ ...base, riskLevel: 'LOW' }, true).satisfied).toBe(true);
    expect(redTeamState({ ...base, lastRedTeamDate: new Date('2026-01-01') }, true).satisfied).toBe(true);
  });
  it('requires a red team after an escalation, satisfied only by a later exercise', () => {
    const esc = { ...base, redTeamRequiredAt: new Date('2026-03-01'), redTeamRequiredReason: 'risk escalation' };
    expect(redTeamState({ ...esc, lastRedTeamDate: new Date('2026-02-01') }, false).satisfied).toBe(false);
    expect(redTeamState({ ...esc, evidenceArtifacts: [{ type: 'red_team', ref: 'r', added_at: '2026-03-05T00:00:00Z' }] }, false).satisfied).toBe(true);
    expect(lastRedTeam({ lastRedTeamDate: new Date('2026-01-01'), evidenceArtifacts: [{ type: 'red_team', ref: 'r', added_at: '2026-02-01' }] } as any)?.toISOString().slice(0, 10)).toBe('2026-02-01');
  });
  it('works out the next audit date for live HIGH systems only', () => {
    const m = { riskLevel: 'HIGH', lifecycleStage: 'DEPLOYED', nextAuditDue: null, deploymentDate: new Date('2025-01-01'), registeredAt: new Date('2024-01-01') } as any;
    expect(auditDue(m, null, 365)?.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(auditDue(m, { createdAt: new Date('2025-06-01'), nextAuditDue: null }, 365)?.toISOString().slice(0, 10)).toBe('2026-06-01');
    // A later explicit date cannot stretch the configured interval; an earlier one brings it forward.
    expect(auditDue({ ...m, nextAuditDue: new Date('2027-01-01') }, null, 365)?.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(auditDue({ ...m, nextAuditDue: new Date('2025-09-01') }, null, 365)?.toISOString().slice(0, 10)).toBe('2025-09-01');
    expect(auditDue({ ...m, riskLevel: 'CRITICAL' }, { createdAt: new Date('2025-06-01'), nextAuditDue: new Date('2028-01-01') }, 365)?.toISOString().slice(0, 10)).toBe('2026-06-01');
    expect(auditDue({ ...m, lifecycleStage: 'DESIGN' }, null, 365)).toBeNull();
    expect(auditDue({ ...m, riskLevel: 'MEDIUM' }, null, 365)).toBeNull();
  });
});

describe('Phase 2 pack content hashes', () => {
  it('match the pre-Phase 2 hashes while Phase 2 is off, and change when it is on', () => {
    const before = process.env.GOVERNANCE_V2;
    delete process.env.GOVERNANCE_V2;
    const r = new PackRegistry();
    const hash = (id: string) => r.versions(id)[0].contentHash;
    const pinned: Record<string, string> = {
      'rbi-free-ai': 'db2ecafde7f81efa05f30066a99839743ff6370e558c4d16950962330cbbbc7f',
      'iso-42001': '03b78e7c1a311753900c27da7c74defe213699527d8f8cc4466c016568eb26ec',
      'nist-ai-rmf': 'd8ef94a362fa98f87f81cdc7c3e0135dc3994445908fd492b5b4b22f5d5d8270',
    };
    try {
      for (const [id, h] of Object.entries(pinned)) expect([id, hash(id)]).toEqual([id, h]);
      process.env.GOVERNANCE_V2 = 'true';
      expect(hash('nist-ai-rmf')).not.toBe(pinned['nist-ai-rmf']);
    } finally {
      if (before === undefined) delete process.env.GOVERNANCE_V2;
      else process.env.GOVERNANCE_V2 = before;
    }
  });
});
