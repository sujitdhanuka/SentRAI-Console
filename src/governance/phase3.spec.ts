/**
 * Unit tests for the Phase 3 governance rules (E3.1 to E3.8): pure functions
 * and the AI-call policy; the API behaviour is covered by the e2e suite.
 */
import { externalCallAllowed } from './hooks';
import { isLocalEndpoint } from '../ai/ai-providers.service';
import { EPIC_FLAGS, flagSet, PHASE3_FLAGS } from '../common/feature-flags';
import { getControl } from './controls/control-library';
import { buildDeveloperDisclosure, buildTransparencyStatement, developerGaps, ModelExtras, ModelRow, ombInventoryRows, OMB_FIELDS, RBI_FIELDS, rbiInspectionRows, transparencyGaps } from './disclosures/disclosures.model';
import { co2eKg, integrateKwh, parseNvidiaSmiCsv, parseSamples } from './energy/energy.model';
import { engagementStatus, parseParticipants } from './engagement/engagement.model';
import { attestedProviders, isSecretColumn, scrubRow, scrubUrl } from './federal/federal.model';
import { closeBlocker, cisaMapping, IncidentLike, incidentFacts, jiraPayload, serviceNowPayload, siemEvent, signBody, ticketRef, webhookUrlProblem } from './incidents/incident-ext.model';
import { PackRegistry } from './packs/pack-loader';
import { approvalProblems as tmProblems, ATTACK_CATEGORIES, mergeThreats, parseEvalCategories, securityFacts, templateThreats } from './security/ai-security.model';
import { ANNEX_A, approvalProblems, buildSoa, deriveStatus, soaHash, soaSummary } from './soa/soa.model';
import { checklistOpen, evaluateRun, newChecklist, parseCriteria, parseResults, RETIREMENT_ITEMS } from './tevv/tevv.model';

import { isPolicyLocalEndpoint } from '../ai/ai-providers.service';
import { governanceHooks } from './hooks';
import { reminderDay } from './disclosures/disclosures.service';
import { providerEndpoint } from './federal/federal.model';
import { isPrivateAddress, maskUrl } from './incidents/incident-ext.model';
import { safeFetch } from './incidents/safe-fetch';
import { isFuture } from './phase2-util';
import { SummarizerService } from '../summarizer/summarizer.service';
const DAY = 86_400_000;
const run = (id: string, ctx: Record<string, any>) =>
  getControl(id)!.evaluate({ entry: {} as any, ctx: ctx as any, params: { values: {}, sources: {} }, flags: flagSet(true), opts: {}, now: new Date('2026-11-18') });

describe('E3.1 Statement of Applicability', () => {
  it('lists all 38 Annex A controls once, each mapped only to library controls', () => {
    expect(ANNEX_A).toHaveLength(38);
    expect(new Set(ANNEX_A.map((c) => c.ref)).size).toBe(38);
    for (const c of ANNEX_A) for (const id of c.controls) expect([c.ref, getControl(id)?.id]).toEqual([c.ref, id]);
  });

  it('derives status from results and never counts NOT ASSESSED as a pass', () => {
    expect(deriveStatus([{ pass: 3, fail: 0, notAssessed: 1 }]).status).toBe('IMPLEMENTED');
    expect(deriveStatus([{ pass: 1, fail: 1, notAssessed: 0 }]).status).toBe('PARTIAL');
    expect(deriveStatus([{ pass: 0, fail: 2, notAssessed: 0 }]).status).toBe('NOT_IMPLEMENTED');
    expect(deriveStatus([{ pass: 0, fail: 0, notAssessed: 4 }, undefined]).status).toBe('NOT_ASSESSED');
  });

  it('a manual status fills only a gap; exclusions need a justification; the hash follows content', () => {
    const tallies = new Map([['CTL-ORG-POLICY', { pass: 1, fail: 0, notAssessed: 0 }]]);
    const entries = new Map<string, { included: boolean; justification: string | null; manualStatus: string | null; manualNote: string | null }>([
      ['A.2.2', { included: true, justification: null, manualStatus: 'NOT_IMPLEMENTED', manualNote: null }],
      ['A.3.3', { included: true, justification: null, manualStatus: 'IMPLEMENTED', manualNote: 'hotline' }],
      ['A.10.4', { included: false, justification: null, manualStatus: null, manualNote: null }],
    ]);
    const rows = buildSoa(entries, tallies);
    expect(rows.find((r) => r.ref === 'A.2.2')).toMatchObject({ status: 'IMPLEMENTED', status_source: 'CONTROLS' });
    expect(rows.find((r) => r.ref === 'A.3.3')).toMatchObject({ status: 'IMPLEMENTED', status_source: 'MANUAL' });
    expect(rows.find((r) => r.ref === 'A.10.4')).toMatchObject({ status: 'NOT_APPLICABLE', included: false });
    expect(approvalProblems(rows)).toEqual(['A.10.4 is excluded without a justification']);
    expect(soaSummary(rows)).toMatchObject({ controls: 38, excluded: 1, manual: 1 });
    const h = soaHash(rows);
    entries.set('A.10.4', { included: false, justification: 'No customers receive our AI systems.', manualStatus: null, manualNote: null });
    const rows2 = buildSoa(entries, tallies);
    expect(approvalProblems(rows2)).toEqual([]);
    expect(soaHash(rows2)).not.toBe(h);
  });
});

const model = (over: Partial<ModelRow> = {}): ModelRow => ({
  id: 'm1', name: 'Scorer', modelType: 'MACHINE_LEARNING', functionalArea: 'credit_underwriting', useCaseDescription: 'Credit scoring', riskLevel: 'HIGH',
  lifecycleStage: 'PRODUCTION', ownerTeam: 'Risk', ownerName: 'A', developedBy: 'IN_HOUSE', humanOversightRequired: true, boardPolicyRef: 'BP-1',
  lastRedTeamDate: null, nextAuditDue: null, deploymentDate: new Date('2026-01-02'), targetCustomerSegments: ['retail'], contextProfile: null,
  energyKwh: 12.5, co2eKg: 8.875, ...over,
});
const extras = (over: Partial<ModelExtras> = {}): ModelExtras => ({
  incidents: { total: 1, open: 0, serious: 0 }, grievances: { total: 2, open: 1 }, audits: { total: 0, lastVerdict: null, lastAt: null }, drift: { reports: 0 },
  bcp: { configured: false, lastDrill: null }, highImpact: true, impactAssessment: 'APPROVED', validation: null, datasets: [], risks: [], ...over,
});

describe('E3.2 disclosures', () => {
  it('builds a transparency statement with every narrative section listed as a gap until written', () => {
    const c = buildTransparencyStatement({
      organisation: 'Org', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-12-31'), models: [model(), model({ id: 'm2', lifecycleStage: 'DECOMMISSIONED' })],
      grievances: [{ category: 'BIAS', status: 'RESOLVED', createdAt: new Date('2026-02-01'), resolvedAt: new Date('2026-02-04') }],
      incidents: [], accountableOfficial: 'CAIO', policyApprovedAt: '2026-01-10', energy: true,
    });
    expect(c.ai_use.systems).toBe(1);
    expect(c.grievances).toMatchObject({ received: 1, resolved: 1, median_days_to_resolve: 3 });
    expect(c.energy).toEqual({ systems_measured: 1, kwh: 12.5, co2e_kg: 8.875 });
    expect(transparencyGaps(c)).toEqual(['intentions', 'monitoring', 'compliance', 'contact']);
  });

  it('fills every RBI and OMB field for each system (no field silently missing)', () => {
    const x = new Map([['m1', extras()]]);
    const rbi = rbiInspectionRows([model()], x);
    for (const f of RBI_FIELDS) expect(Object.keys(rbi[0])).toContain(f.key);
    const omb = ombInventoryRows('Org', [model()], x);
    for (const f of OMB_FIELDS) expect(Object.keys(omb[0])).toContain(f.key);
  });

  it('a developer disclosure lists its gaps instead of inventing content', () => {
    const c = buildDeveloperDisclosure(model(), extras(), [{ name: 'Bank A' }]);
    expect(c.deployers).toEqual(['Bank A']);
    expect(developerGaps(c)).toEqual(['known harmful or inappropriate uses', 'known limitations', 'training data summary']);
  });
});

const incident = (over: Partial<IncidentLike> = {}): IncidentLike => ({
  id: 'i1', modelId: 'm1', modelName: 'Scorer', severity: 'P1_CRITICAL', status: 'UNDER_INVESTIGATION', incidentCategory: 'BIAS_DETECTED',
  description: 'Bias found', reportingDeadline: new Date('2026-11-20'), createdAt: new Date('2026-11-18'), affectedConsumers: { count: 12 }, ...over,
});

describe('E3.3 incident extensions', () => {
  it('serious incidents need sign-off and notice before closing', () => {
    expect(closeBlocker(incident({ severity: 'P3_MEDIUM' }))).toBeNull();
    expect(closeBlocker(incident())).toMatch(/sign-off/);
    expect(closeBlocker(incident({ seniorSignOffAt: new Date() }))).toMatch(/notice/);
    expect(closeBlocker(incident({ seniorSignOffAt: new Date(), affectedPartiesNotifiedAt: new Date() }))).toBeNull();
    expect(closeBlocker(incident({ seniorSignOffAt: new Date(), governanceExt: { notice: { notRequiredReason: 'No one identifiable' } } }))).toBeNull();
    expect(incidentFacts([incident({ status: 'CLOSED' })])).toEqual({ serious: 1, closedWithoutSignOff: 1, openSeriousUnnotified: 1 });
  });

  it('builds Jira, ServiceNow and SIEM payloads and reads ticket references back', () => {
    const j = jiraPayload(incident(), { projectKey: 'AIGOV' });
    expect(j.fields).toMatchObject({ project: { key: 'AIGOV' }, priority: { name: 'Highest' } });
    expect(serviceNowPayload(incident())).toMatchObject({ urgency: '1', impact: '1' });
    expect(siemEvent('DRIFT_ALERT', 'o1', { modelId: 'm1', severity: 'P2_HIGH' })).toMatchObject({ event_class: 'DRIFT_ALERT', severity: 8, tenant: 'o1' });
    expect(ticketRef('JIRA', { key: 'AIGOV-7' })).toBe('AIGOV-7');
    expect(ticketRef('SERVICENOW', { result: { number: 'INC001' } })).toBe('INC001');
    expect(signBody('s3cret', '{}')).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(cisaMapping(incident()).phases.length).toBeGreaterThan(0);
  });

  it('webhook URLs must be https, credential-free and not private', () => {
    expect(webhookUrlProblem('http://example.com/h')).toMatch(/https/);
    expect(webhookUrlProblem('https://u:p@example.com/h')).toMatch(/credentials/);
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '[::1]', 'db.internal']) {
      expect([h, webhookUrlProblem(`https://${h}/x`)]).toEqual([h, expect.stringMatching(/private/)]);
    }
    expect(webhookUrlProblem('https://10.0.0.1/x', true)).toBeNull();
    expect(webhookUrlProblem('https://hooks.example.com/x')).toBeNull();
  });
});

describe('E3.4 TEVV and retirement', () => {
  it('every criterion must be met, per segment where asked; a missing metric fails', () => {
    const criteria = parseCriteria([{ metric: 'auc', operator: '>=', threshold: 0.8 }, { metric: 'fpr', operator: '<=', threshold: 0.1, segment: '*' }, { metric: 'recall', operator: '>=', threshold: 0.5 }]);
    const results = parseResults([{ metric: 'auc', value: 0.85 }, { metric: 'fpr', value: 0.05, segment: 'urban' }, { metric: 'fpr', value: 0.2, segment: 'rural' }]);
    const r = evaluateRun(criteria, results);
    expect(r.passed).toBe(false);
    expect(r.failures).toEqual([
      { metric: 'fpr', segment: 'rural', reason: 'above', value: 0.2, threshold: 0.1 },
      { metric: 'recall', segment: null, reason: 'missing', value: null, threshold: 0.5 },
    ]);
    expect(() => parseCriteria([{ metric: 'auc', operator: '>', threshold: 1 }])).toThrow(/operator/);
    expect(() => parseResults([{ metric: 'auc', value: 'x' }])).toThrow(/number/);
  });

  it('the retirement checklist has every item open until done', () => {
    const c = newChecklist({ DATA_RETENTION: 'Delete after 7 years' });
    expect(c.map((i) => i.key)).toEqual(RETIREMENT_ITEMS.map((i) => i.key));
    expect(checklistOpen(c)).toHaveLength(6);
    expect(checklistOpen(c.map((i) => ({ ...i, done: true })))).toEqual([]);
  });
});

describe('E3.5 energy', () => {
  it('integrates recorded GPU samples to kWh, skipping gaps, and converts with the grid factor', () => {
    // 2 GPUs at 300 W for one hour, sampled every minute = 0.6 kWh; a 20-minute outage is not counted.
    const t0 = Date.parse('2026-11-01T00:00:00Z');
    const samples: Array<{ at: string; power_w: number }> = [];
    for (let m = 0; m <= 60; m++) samples.push({ at: new Date(t0 + m * 60_000).toISOString(), power_w: 600 });
    expect(integrateKwh(parseSamples(samples)).kwh).toBeCloseTo(0.6, 6);
    const gap = [...samples, { at: new Date(t0 + 80 * 60_000).toISOString(), power_w: 600 }];
    expect(integrateKwh(parseSamples(gap))).toMatchObject({ gaps: 1 });
    expect(integrateKwh(parseSamples(gap)).kwh).toBeCloseTo(0.6, 6);
    expect(co2eKg(10, 0.71)).toBeCloseTo(7.1, 6);
  });

  it('reads nvidia-smi CSV logs and sums GPUs at the same timestamp', () => {
    const csv = [
      'timestamp, index, power.draw [W]',
      '2026/11/01 00:00:00.000, 0, 100.00 W',
      '2026/11/01 00:00:00.000, 1, 200.00 W',
      '2026/11/01 01:00:00.000, 0, 100.00 W',
      '2026/11/01 01:00:00.000, 1, 200.00 W',
    ].join('\n');
    const s = parseNvidiaSmiCsv(csv);
    expect(s.map((x) => x.powerW)).toEqual([300, 300]);
    expect(integrateKwh(s, 3600).kwh).toBeCloseTo(0.3, 6);
  });
});

describe('E3.6 AI security', () => {
  it('maps every attack category to at least one external reference and picks applicability by model type', () => {
    for (const c of ATTACK_CATEGORIES) expect(c.atlas.length + c.owasp.length).toBeGreaterThan(0);
    const ml = templateThreats('MACHINE_LEARNING');
    expect(ml.find((t) => t.category === 'PROMPT_INJECTION')!.applicable).toBe(false);
    expect(ml.find((t) => t.category === 'DATA_POISONING')!.applicable).toBe(true);
    expect(templateThreats('AGENT').find((t) => t.category === 'EXCESSIVE_AGENCY')!.applicable).toBe(true);
  });

  it('approval needs every applicable threat rated and mitigated, and every exclusion explained', () => {
    let t = templateThreats('MACHINE_LEARNING');
    expect(tmProblems(t).length).toBeGreaterThan(0);
    t = mergeThreats(t, t.map((x) => (x.applicable ? { category: x.category, likelihood: 2, impact: 3, mitigations: 'Rate limits' } : { category: x.category, rationale: 'No LLM' })));
    expect(tmProblems(t)).toEqual([]);
    expect(() => mergeThreats(t, [{ category: 'NOPE' }])).toThrow(/category/);
    expect(() => mergeThreats(t, [{ category: 'EVASION', likelihood: 9 }])).toThrow(/1 to 5/);
  });

  it('facts: untested and failing-unmitigated applicable categories', () => {
    const threats = templateThreats('MACHINE_LEARNING');
    const evals = parseEvalCategories([{ category: 'DATA_POISONING', result: 'PASS' }, { category: 'EVASION', result: 'FAIL', findings: 'FGSM flips 30%' }]);
    expect(() => parseEvalCategories([{ category: 'EVASION', result: 'FAIL' }])).toThrow(/findings/);
    const f = securityFacts({ status: 'APPROVED', threats }, [{ evaluatedAt: new Date(), categories: evals }]);
    expect(f.failingUnmitigated).toEqual(['EVASION']);
    expect(f.untested).toContain('MODEL_EXTRACTION');
    expect(run('CTL-SEC-AI-01', { governance: { aiSecurity: f } }).key).toBe('untested');
    expect(run('CTL-SEC-AI-01', { governance: {} }).notAssessed).toBe(true);
    expect(securityFacts(null, []).threatModel).toBe('NONE');
  });
});

describe('E3.7 engagement records', () => {
  it('reports the status of every people-side item in both modes', () => {
    const items = { stakeholder_panels: { mode: 'LIGHT_RECORD' }, expert_input: { mode: 'CUSTOMER', owner: 'Bank risk team' }, team_diversity: { mode: 'CUSTOMER', owner: null } };
    const s = engagementStatus(items, [{ type: 'CONSULTATION', occurredAt: new Date(Date.now() - 10 * DAY) }, { type: 'CONSULTATION', occurredAt: new Date(Date.now() - 1000 * DAY) }]);
    expect(s.stakeholder_panels).toMatchObject({ status: 'RECORDED', records: 1 });
    expect(s.expert_input).toMatchObject({ status: 'CUSTOMER_OWNED', owner: 'Bank risk team' });
    expect(s.team_diversity.status).toBe('NO_OWNER');
    expect(run('CTL-ORG-ENGAGEMENT', { org: { engagement: { items: s } } }).key).toBe('no_owner');
    expect(engagementStatus({ stakeholder_panels: { mode: 'LIGHT_RECORD' } }, []).stakeholder_panels.status).toBe('MISSING');
  });

  it('records participants as roles, not people', () => {
    expect(parseParticipants(['Branch customers', { role: 'Credit SME', count: 3 }])).toEqual([{ role: 'Branch customers', count: null }, { role: 'Credit SME', count: 3 }]);
    expect(() => parseParticipants([])).toThrow(/1 to 50/);
  });
});

describe('E3.8 federal vendor', () => {
  it('refuses external AI calls the policy does not allow', () => {
    expect(externalCallAllowed(undefined, false, 'p1')).toBe(true);
    expect(externalCallAllowed({ mode: 'ALLOWED', attestedProviderIds: [] }, false, 'p1')).toBe(true);
    expect(externalCallAllowed({ mode: 'BLOCKED', attestedProviderIds: ['p1'] }, false, 'p1')).toBe(false);
    expect(externalCallAllowed({ mode: 'BLOCKED', attestedProviderIds: [] }, true, null)).toBe(true);
    expect(externalCallAllowed({ mode: 'ATTESTED_ONLY', attestedProviderIds: ['p1'] }, false, 'p1')).toBe(true);
    expect(externalCallAllowed({ mode: 'ATTESTED_ONLY', attestedProviderIds: ['p1'] }, false, 'p2')).toBe(false);
    // The platform-level provider has no attestation of its own.
    expect(externalCallAllowed({ mode: 'ATTESTED_ONLY', attestedProviderIds: ['p1'] }, false, null)).toBe(false);
    expect(isLocalEndpoint('http://localhost:11434')).toBe(true);
    expect(isLocalEndpoint('https://api.anthropic.com')).toBe(false);
  });

  it('only current no-training attestations count', () => {
    const now = new Date('2026-11-18');
    expect(attestedProviders([
      { providerId: 'a', noTraining: true, revokedAt: null, expiresAt: null },
      { providerId: 'b', noTraining: false, revokedAt: null, expiresAt: null },
      { providerId: 'c', noTraining: true, revokedAt: new Date('2026-10-01'), expiresAt: null },
      { providerId: 'd', noTraining: true, revokedAt: null, expiresAt: new Date('2026-11-01') },
    ], now)).toEqual(['a']);
  });

  it('the org export drops secret columns and URL credentials', () => {
    expect(['hashedPassword', 'apiKeyEncrypted', 'secretEncrypted', 'resetToken'].every(isSecretColumn)).toBe(true);
    expect(['tokensIn', 'tokensOut', 'contentHash', 'email'].some(isSecretColumn)).toBe(false);
    expect(scrubRow({ email: 'a@b.c', hashedPassword: 'x', url: 'https://u:p@h.example/x?token=1' })).toEqual({ email: 'a@b.c', url: 'https://h.example/x?redacted' });
    expect(scrubUrl('https://h.example/x')).toBe('https://h.example/x');
  });
});

describe('Phase 3 pack content hashes', () => {
  const env = (vars: Record<string, string | undefined>, fn: () => void) => {
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { fn(); } finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };
  const hashes = () => {
    const r = new PackRegistry();
    return Object.fromEntries(['rbi-free-ai', 'iso-42001', 'nist-ai-rmf', 'au-dta', 'us-2026'].map((id) => [id, r.versions(id)[0].contentHash]));
  };
  /** The Phase 2 hashes (feat/gov-phase2, GOVERNANCE_V2 on). */
  const PHASE2 = {
    'rbi-free-ai': '43f505dc8bf7cba1761db183e9f7a2ba22d234e368620476ca6a4b6c4c9ad17e',
    'iso-42001': 'bb3546a89cddce9adff08773aa2e747ff780438dba1705829c5d5b9e1ee12754',
    'nist-ai-rmf': '9af53a72cfa088476801416d3b03496d5e79a5b3e79fb171155daa3ebdb4748d',
    'au-dta': '72fb5a722990a61d4f0da1478b243a700f7918a946f1b898fa011ed4ebfb3579',
    'us-2026': '6eb83a6a9c9ef5f6922cde3bebe271f3cdd6f22ff86c400a376e2b8443fe4a98',
  };
  const off = Object.fromEntries(PHASE3_FLAGS.map((f) => [EPIC_FLAGS[f], 'false']));

  it('match the Phase 2 hashes while Phase 3 is off, and change when it is on', () => {
    env({ GOVERNANCE_V2: 'true', ...off }, () => expect(hashes()).toEqual(PHASE2));
    env({ GOVERNANCE_V2: 'true' }, () => {
      const h = hashes();
      for (const id of Object.keys(PHASE2)) expect([id, h[id]]).not.toEqual([id, PHASE2[id as keyof typeof PHASE2]]);
    });
  });
});

/* ------------------------------------------------ review fixes (independent review) */


describe('review fixes', () => {
  it('H1: webhook URLs and resolved addresses in private ranges are refused, including mapped and CGNAT forms', () => {
    for (const ip of ['127.0.0.1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1', '100.100.100.200', '0.0.0.1', '10.0.0.5', 'fd00::1', 'fe80::1', '::1', '::']) {
      expect([ip, isPrivateAddress(ip)]).toEqual([ip, true]);
    }
    for (const ip of ['8.8.8.8', '2606:4700::1111', '100.63.0.1']) expect([ip, isPrivateAddress(ip)]).toEqual([ip, false]);
    for (const u of ['https://[::ffff:127.0.0.1]/', 'https://[::ffff:169.254.169.254]/', 'https://100.100.100.200/', 'https://0.0.0.1/', 'https://2130706433/', 'https://svc.home.arpa/']) {
      expect([u, webhookUrlProblem(u)]).toEqual([u, expect.stringMatching(/private/)]);
    }
  });

  it('H1: a host that resolves to a private address is refused at send time', async () => {
    const fakeDns: any = (_h: string, _o: unknown, cb: (e: Error | null, a: Array<{ address: string; family: number }>) => void) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
    await expect(safeFetch('https://127.0.0.1.nip.io/hook', { method: 'POST', headers: {}, body: '{}' }, false, fakeDns)).rejects.toThrow(/blocked/);
  });

  it('webhook URLs are shown without path or query secrets', () => {
    expect(maskUrl('https://hooks.slack.com/services/T000/B000/XXXX?x=1')).toBe('https://hooks.slack.com/services/…?…');
    expect(maskUrl('https://soc.example.com/ingest')).toBe('https://soc.example.com/ingest');
    expect(scrubRow({ url: 'https://hooks.slack.com/services/T000/B000/XXXX' })).toEqual({ url: 'https://hooks.slack.com/services/redacted' });
  });

  it('H2: the external-AI policy of the organisation that owns the data applies to a platform admin', async () => {
    const prev = governanceHooks.externalAiPolicy;
    governanceHooks.externalAiPolicy = async (t) => (t === 'org-x' ? { mode: 'BLOCKED', attestedProviderIds: [] } : undefined);
    try {
      const config: any = { get: () => ({ provider: 'anthropic', apiKey: 'k', baseUrl: 'https://api.anthropic.com', model: 'm', maxSnippetChars: 100 }) };
      const providers: any = { resolveActiveForOrg: async () => null };
      const vault: any = { resolveActiveBody: async () => ({ body: '{{name}}' }) };
      const s = new SummarizerService(config, providers, vault, {} as any);
      expect(await s.aiEnabledForOrg(null)).toBe(true);
      expect(await s.aiEnabledForOrg(null, ['org-x'])).toBe(false);
      const d = await s.draftForOrg(null, 'risk_rationale', { name: 'x' }, () => 'local text', 'admin', ['org-x']);
      expect(d).toMatchObject({ source: 'heuristic', text: 'local text' });
    } finally {
      governanceHooks.externalAiPolicy = prev;
    }
  });

  it('M1: an attestation stops counting when the provider is pointed somewhere else', () => {
    const ep = providerEndpoint({ baseUrl: 'https://llm.example.com/v1', model: 'm-1' });
    const rows = [{ providerId: 'p', noTraining: true, revokedAt: null, expiresAt: null, endpoint: ep }];
    expect(attestedProviders(rows, new Date(), new Map([['p', ep]]))).toEqual(['p']);
    expect(attestedProviders(rows, new Date(), new Map([['p', providerEndpoint({ baseUrl: 'https://other.example.com/v1', model: 'm-1' })]]))).toEqual([]);
    expect(attestedProviders(rows, new Date(), new Map([['p', providerEndpoint({ baseUrl: 'https://llm.example.com/v1', model: 'm-2' })]]))).toEqual([]);
  });

  it('L4: transparency review reminders go out 30 and 7 days ahead, on the day and weekly after', () => {
    const due = new Date('2027-01-31T10:00:00Z');
    const on = (d: string) => reminderDay(due, new Date(`${d}T07:00:00Z`));
    expect(['2027-01-01', '2027-01-24', '2027-01-31', '2027-02-07'].map(on)).toEqual([true, true, true, true]);
    expect(['2027-01-02', '2027-01-30', '2027-02-01', '2027-02-06'].map(on)).toEqual([false, false, false, false]);
  });

  it('L6: a date-only "today" is not the future for someone ahead of UTC', () => {
    const now = Date.parse('2026-11-18T11:00:00Z'); // 01:00 on the 19th in UTC+14
    expect(isFuture(new Date('2026-11-19'), '2026-11-19', now)).toBe(false);
    expect(isFuture(new Date('2026-11-21'), '2026-11-21', now)).toBe(true);
    expect(isFuture(new Date('2026-11-19T00:00:00Z'), '2026-11-19T00:00:00Z', now)).toBe(true);
  });

  it('L7: a .local name does not count as local under the external-AI policy', () => {
    expect(isPolicyLocalEndpoint('http://gpu-box.local:11434')).toBe(false);
    expect(isPolicyLocalEndpoint('http://127.0.0.1:11434')).toBe(true);
    expect(isPolicyLocalEndpoint('http://10.0.0.4:8000')).toBe(true);
  });

  it('nvidia-smi rows of several GPUs a few milliseconds apart are summed into one sample', () => {
    const csv = [
      'timestamp, index, power.draw [W]',
      '2026/11/01 00:00:00.120, 0, 100.00 W',
      '2026/11/01 00:00:00.135, 1, 200.00 W',
      '2026/11/01 01:00:00.118, 0, 100.00 W',
      '2026/11/01 01:00:00.131, 1, 200.00 W',
    ].join('\n');
    expect(parseNvidiaSmiCsv(csv).map((x) => x.powerW)).toEqual([300, 300]);
  });
});
