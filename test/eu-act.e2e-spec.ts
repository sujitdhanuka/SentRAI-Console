import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

/** EU AI Act workspace (E5.1): dark behind GOV_E5_1_EU_ACT, only for organisations with the EU pack enabled. */
describe('EU AI Act workspace (e2e)', () => {
  let app: INestApplication;
  let http: any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = async (username: string, password: string): Promise<string> => {
    const res = await request(http).post('/api/v1/auth/token').type('form').send({ username, password });
    expect(res.status).toBe(200);
    return res.body.access_token;
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const withEnv = async (vars: Record<string, string>, fn: () => Promise<void>) => {
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; process.env[k] = v; }
    try { await fn(); } finally {
      for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };

  const setupOrg = async (name: string) => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const org = await request(http).post('/api/v1/organizations').set(auth(admin)).send({ name, description: 'test' }).expect(201);
    const user = async (role: string) => {
      const email = `${role.toLowerCase()}@${name.toLowerCase()}.test`;
      await request(http).post('/api/v1/users').set(auth(admin))
        .send({ email, full_name: `${name} ${role}`, password: 'pw123456', role, organization_id: org.body.organization_id }).expect(201);
      return login(email, 'pw123456');
    };
    const owner = await user('OWNER');
    const viewer = await user('VIEWER');
    const project = await request(http).post('/api/v1/projects').set(auth(owner)).send({ name: `${name} App`, root_directory: process.cwd() }).expect(201);
    const addModel = async (suffix: string, area = 'credit_underwriting') => (await request(http).post('/api/v1/inventory/models').set(auth(owner)).send({
      name: `${name} ${suffix}`, model_type: 'MACHINE_LEARNING', functional_area: area, risk_level: 'HIGH',
      use_case_description: 'Scores SME credit applications for the underwriting team', human_oversight_required: true,
      board_policy_ref: 'BP-1', project_id: project.body.project_id, target_customer_segments: ['sme'],
    }).expect(201)).body.model_id as string;
    const modelId = await addModel('Credit');
    return { admin, owner, viewer, orgId: org.body.organization_id, modelId, addModel };
  };
  const enableEu = (token: string) =>
    request(http).put('/api/v1/governance/settings').set(auth(token)).send({ settings: { enabledPacks: ['eu-ai-act'] }, reason: 'EU customers in scope' }).expect(200);
  const euChecks = async (token: string, modelId: string) =>
    (await request(http).get(`/api/v1/inventory/models/${modelId}/compliance-check`).set(auth(token)).expect(200)).body.eu_ai_act;
  const check = (eu: any, code: string, controlName?: string) => eu.checks.find((c: any) => c.control_code === code && (!controlName || c.name === controlName));
  const allNo = { manipulation: 'NO', vulnerabilities: 'NO', social_scoring: 'NO', crime_prediction: 'NO', facial_scraping: 'NO', emotion_work_school: 'NO', biometric_categorisation: 'NO', realtime_rbi: 'NO' };

  it('is dark with the flags off and with the EU flag off', async () => {
    const o = await setupOrg('EuOff');
    await request(http).get('/api/v1/governance/eu').set(auth(o.owner)).expect(404);
    const f = (await request(http).get('/api/v1/governance/features').set(auth(o.owner)).expect(200)).body;
    expect(f.euAiAct).toBeUndefined();
    await withEnv({ GOVERNANCE_V2: 'true', GOV_E5_1_EU_ACT: 'false' }, async () => {
      await enableEu(o.owner);
      await request(http).get('/api/v1/governance/eu').set(auth(o.owner)).expect(404);
      const eu = await euChecks(o.owner, o.modelId);
      expect(eu.checks.map((c: any) => c.control_code)).not.toContain('Art-5');
      expect(eu.risk_tier).toBe('High Risk');
    });
  });

  it('applies only to organisations that enable the EU pack', async () => {
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const o = await setupOrg('EuNotEnabled');
      const ov = (await request(http).get('/api/v1/governance/eu').set(auth(o.owner)).expect(200)).body;
      expect(ov.active).toBe(false);
      await request(http).get(`/api/v1/governance/eu/models/${o.modelId}`).set(auth(o.owner)).expect(409);
    });
  });

  it('records the operator role, Art. 5 screening and Annex III classification, and the pack follows them', async () => {
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const o = await setupOrg('EuCore');
      const other = await setupOrg('EuOther');
      await enableEu(o.owner);
      const base = `/api/v1/governance/eu/models/${o.modelId}`;
      // New EU clauses appear once the pack is enabled; Art. 5 fails until the screening is signed.
      let eu = await euChecks(o.owner, o.modelId);
      expect(check(eu, 'Art-5').passed).toBe(false);
      expect(check(eu, 'Art-5').mandatory).toBe(true);
      expect(check(eu, 'Art-6').gap).toMatch(/Annex III/);

      await request(http).put(`${base}/profile`).set(auth(o.viewer)).send({ roles: ['PROVIDER'] }).expect(403);
      await request(http).get(base).set(auth(other.owner)).expect(404);
      await request(http).put(`${base}/profile`).set(auth(o.owner)).send({ roles: ['MANUFACTURER'] }).expect(400);
      await request(http).put(`${base}/profile`).set(auth(o.owner)).send({
        roles: ['provider', 'deployer'], scope: { placedOnEuMarket: true, outputUsedInEu: true, exclusion: 'NONE' },
        provider: { name: 'Acme Lending BV', address: 'Keizersgracht 1, Amsterdam', contact: 'ai@acme.example', establishedInEu: true },
      }).expect(200);

      // Art. 5: all eight answers before signing; an exception needs a description and only where the Act has one.
      await request(http).put(`${base}/art5`).set(auth(o.owner)).send({ answers: { manipulation: 'NO' } }).expect(200);
      await request(http).post(`${base}/art5/sign`).set(auth(o.owner)).expect(400);
      await request(http).put(`${base}/art5`).set(auth(o.owner)).send({ answers: { social_scoring: { answer: 'YES', exception: 'A long enough exception text here' } } }).expect(400);
      await request(http).put(`${base}/art5`).set(auth(o.owner)).send({ answers: allNo }).expect(200);
      await request(http).post(`${base}/art5/sign`).set(auth(o.viewer)).expect(403);
      await request(http).post(`${base}/art5/sign`).set(auth(o.owner)).expect(201);
      eu = await euChecks(o.owner, o.modelId);
      expect(check(eu, 'Art-5').passed).toBe(true);

      // Art. 6(3): profiling rules the derogation out.
      await request(http).put(`${base}/classification`).set(auth(o.owner))
        .send({ annex_iii: ['5(b)'], annex_i_product: false, profiling: true, derogation: 'PREPARATORY', derogation_reasoning: 'x'.repeat(60) }).expect(400);
      await request(http).put(`${base}/classification`).set(auth(o.owner)).send({ annex_iii: ['5(b)'], annex_i_product: false, profiling: true }).expect(200);
      const ws = (await request(http).post(`${base}/classification/sign`).set(auth(o.owner)).expect(201)).body;
      expect(ws.tier).toBe('High Risk');
      expect(ws.tier_basis).toMatch(/5\(b\)/);
      eu = await euChecks(o.owner, o.modelId);
      expect(eu.risk_tier).toBe('High Risk');
      // Provider and deployer clauses both apply; Annex VIII section A is required and missing.
      expect(check(eu, 'Art-43').passed).toBe(false);
      expect(check(eu, 'Art-49').gap).toMatch(/section A/);
      expect(check(eu, 'Art-27', 'FRIA Signed and Authority Notified').passed).toBe(false);

      // A deployer-only role drops the provider clauses.
      await request(http).put(`${base}/profile`).set(auth(o.owner)).send({ roles: ['DEPLOYER'] }).expect(200);
      eu = await euChecks(o.owner, o.modelId);
      expect(check(eu, 'Art-43')).toBeUndefined();
      expect(check(eu, 'Art-26', 'Deployer Duties')).toBeDefined();
      await request(http).put(`${base}/profile`).set(auth(o.owner)).send({ roles: ['PROVIDER', 'DEPLOYER'] }).expect(200);

      // Registration only for the sections that apply.
      await request(http).post(`${base}/registrations`).set(auth(o.owner)).send({ section: 'B', eu_database_id: 'EU-123' }).expect(400);
      await request(http).post(`${base}/registrations`).set(auth(o.owner)).send({ section: 'A', eu_database_id: 'EU-123' }).expect(201);
      eu = await euChecks(o.owner, o.modelId);
      expect(check(eu, 'Art-49').passed).toBe(true);

      // Conformity: a pass needs the Annex IV documentation complete; a FAILED outcome can be signed.
      const conf = (await request(http).post(`${base}/conformity`).set(auth(o.owner)).send({ route: 'INTERNAL_CONTROL', items: { QMS: { ok: true }, TECH_DOC: { ok: true }, DESIGN_PMM: { ok: true } } }).expect(201)).body;
      const refused = await request(http).post(`/api/v1/governance/eu/conformity/${conf.record_id}/sign`).set(auth(o.owner)).send({ outcome: 'PASSED' }).expect(400);
      expect(refused.body.message).toMatch(/Annex IV/);
      await request(http).post(`${base}/declaration`).set(auth(o.owner)).send({ signer_name: 'A', signer_function: 'CEO', place: 'Amsterdam' }).expect(400);

      // Exports.
      const md = await request(http).get(`${base}/export/annex-iv?format=md`).set(auth(o.owner)).expect(200);
      expect(md.text).toMatch(/Annex IV/);
      const ifu = (await request(http).get(`${base}/export/instructions`).set(auth(o.owner)).expect(200)).body;
      expect(ifu.document['13(3)(a) Provider identity and contact'].name).toBe('Acme Lending BV');
      const viii = (await request(http).get(`${base}/export/annex-viii?section=A`).set(auth(o.owner)).expect(200)).body;
      expect(viii.section).toBe('A');
      const bundle = (await request(http).get(`${base}/export/authority`).set(auth(o.owner)).expect(200)).body;
      expect(bundle.technical_documentation.sections.length).toBe(9);
    });
  });

  it('blocks a prohibited practice at the deploy gate whatever the gate mode', async () => {
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const o = await setupOrg('EuArt5');
      await enableEu(o.owner);
      const base = `/api/v1/governance/eu/models/${o.modelId}`;
      await request(http).put(`${base}/art5`).set(auth(o.owner)).send({ answers: { ...allNo, social_scoring: 'YES' } }).expect(200);
      await request(http).post(`${base}/art5/sign`).set(auth(o.owner)).expect(201);
      const gate = (await request(http).get(`/api/v1/governance/models/${o.modelId}/gate`).set(auth(o.owner)).expect(200)).body;
      expect(gate.verdict).toBe('BLOCK');
      expect(gate.block.map((b: any) => b.code)).toContain('eu_prohibited_practice');
      const eu = await euChecks(o.owner, o.modelId);
      expect(eu.risk_tier).toBe('Prohibited');
      expect(check(eu, 'Art-5').passed).toBe(false);
      expect(check(eu, 'Art-5').gap).toMatch(/social_scoring/);
    });
  });

  it('runs the Art. 73 clocks, the Art. 86 path, Art. 25 change assessments, Art. 20 actions and the organisation record', async () => {
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const o = await setupOrg('EuOps');
      const other = await setupOrg('EuOps2');
      await enableEu(o.owner);
      const base = `/api/v1/governance/eu/models/${o.modelId}`;
      await request(http).put(`${base}/profile`).set(auth(o.owner)).send({ roles: ['PROVIDER', 'DEPLOYER'], provider: { establishedInEu: false } }).expect(200);
      await request(http).put(`${base}/art5`).set(auth(o.owner)).send({ answers: allNo }).expect(200);
      await request(http).post(`${base}/art5/sign`).set(auth(o.owner)).expect(201);
      await request(http).put(`${base}/classification`).set(auth(o.owner)).send({ annex_iii: ['5(b)'], annex_i_product: false, profiling: true }).expect(200);
      await request(http).post(`${base}/classification/sign`).set(auth(o.owner)).expect(201);

      // Art. 73: a death gives 10 days from awareness.
      const inc = (await request(http).post('/api/v1/compliance/incident/report').set(auth(o.owner)).send({
        model_id: o.modelId, model_name: 'Credit', re_name: 'Acme', functional_area: 'credit_underwriting', incident_category: 'BIAS_DISCRIMINATION',
        severity: 'P1_CRITICAL', description: 'Model produced harmful outcomes for a group of applicants repeatedly', observed_at: '2026-07-11T06:00:00Z',
        detected_at: '2026-07-11T06:30:00Z', model_risk_level: 'HIGH', immediate_action_taken: 'Suspended the model and moved decisions to the manual fallback',
      }).expect(201)).body;
      const incId = inc.incident_id ?? inc.id;
      let eu = await euChecks(o.owner, o.modelId);
      expect(check(eu, 'Art-73', 'Serious Incident Reporting Clocks').gap).toMatch(/not classified/);
      await request(http).put(`/api/v1/governance/eu/incidents/${incId}`).set(auth(other.owner)).send({ classification: 'DEATH' }).expect(404);
      await request(http).put(`/api/v1/governance/eu/incidents/${incId}`).set(auth(o.owner)).send({ classification: 'NOPE' }).expect(400);
      const r = (await request(http).put(`/api/v1/governance/eu/incidents/${incId}`).set(auth(o.owner)).send({ classification: 'DEATH' }).expect(200)).body;
      expect(r.eu.deadlineAt).toBe('2026-07-21T06:30:00.000Z');
      expect(r.eu_status.overdue).toBe(true);
      eu = await euChecks(o.owner, o.modelId);
      expect(check(eu, 'Art-73', 'Serious Incident Reporting Clocks').passed).toBe(false);
      await request(http).put(`/api/v1/governance/eu/incidents/${incId}`).set(auth(o.owner)).send({ reported_at: '2026-07-15', authority: 'AP (NL)', state_recorded_at: '2026-07-11', state_description: 'Model v3 frozen, weights hashed', not_altered: true }).expect(200);
      eu = await euChecks(o.owner, o.modelId);
      expect(check(eu, 'Art-73', 'Serious Incident Reporting Clocks').passed).toBe(true);
      const report = (await request(http).get(`/api/v1/governance/eu/incidents/${incId}/report`).set(auth(o.owner)).expect(200)).body;
      expect(report.incident.classification).toMatch(/Death/);

      // Art. 86: the public request is recorded; staff answer it from the explainability record.
      const ref = `EU-DEC-${Date.now()}`;
      await request(http).post(`/api/v1/governance/public/eu/decisions/${o.modelId}/explanations`).send({ decision_ref: ref }).expect(404);
      await request(http).post('/api/v1/audit/explainability/record').set(auth(o.admin)).send({
        model_id: o.modelId, decision_ref: ref, top_features: { dti: 0.6, late: 0.3 }, decision_outcome: 'DECLINED', confidence_score: 0.8, explanation_method: 'SHAP', human_readable_summary: 'Declined on affordability', is_contestable: true,
      }).expect(201);
      const pub = (await request(http).post(`/api/v1/governance/public/eu/decisions/${o.modelId}/explanations`).send({ decision_ref: ref, requester: 'jane@example.com' }).expect(201)).body;
      expect(pub.status).toBe('RECEIVED');
      const queue = (await request(http).get('/api/v1/governance/eu/queue').set(auth(o.owner)).expect(200)).body;
      const req = queue.items.find((i: any) => i.kind === 'EXPLANATION');
      expect(req.data.requester).toBe('ja***@example.com');
      const ans = (await request(http).post(`/api/v1/governance/eu/explanations/${req.record_id}/answer`).set(auth(o.owner)).send({}).expect(201)).body;
      expect(ans.data.explanation).toMatch(/Main elements of the decision: dti/);

      // Art. 25: a context change opens an assessment; a substantial modification puts the provider duties on.
      await request(http).patch(`/api/v1/inventory/models/${o.modelId}/context`).set(auth(o.owner)).send({ intended_users: ['SME underwriters'] }).expect(200);
      const change = (await request(http).get('/api/v1/governance/eu/queue').set(auth(o.owner)).expect(200)).body.items.find((i: any) => i.kind === 'CHANGE');
      expect(change.status).toBe('OPEN');
      await request(http).post(`/api/v1/governance/eu/changes/${change.record_id}/assess`).set(auth(o.owner)).send({ substantial_modification: 'yes' }).expect(400);
      await request(http).post(`/api/v1/governance/eu/changes/${change.record_id}/assess`).set(auth(o.owner))
        .send({ substantial_modification: true, purpose_changed_to_high_risk: false, own_name_or_trademark: false, reasoning: 'New intended users change the risk profile materially' }).expect(201);

      // Art. 20: a system presenting a risk cannot be closed before the authority is told.
      const nc = (await request(http).post(`${base}/nonconformities`).set(auth(o.owner)).send({ action: 'WITHDRAW', description: 'Accuracy below declared level', presents_risk: true }).expect(201)).body;
      await request(http).put(`/api/v1/governance/eu/nonconformities/${nc.record_id}`).set(auth(o.owner)).send({ status: 'CLOSED', outcome: 'Withdrawn and retrained' }).expect(400);
      await request(http).put(`/api/v1/governance/eu/nonconformities/${nc.record_id}`).set(auth(o.owner)).send({ status: 'CLOSED', outcome: 'Withdrawn and retrained', informed: { authority: '2026-11-01' } }).expect(200);

      // Organisation: log retention below six months is refused; a provider outside the EU needs an authorised representative.
      await request(http).put('/api/v1/governance/eu/org').set(auth(o.owner)).send({ log_retention: { telemetry: 3 } }).expect(400);
      let ov = (await request(http).put('/api/v1/governance/eu/org').set(auth(o.owner)).send({ log_retention: { telemetry: 12, ledger: 120, audit: 84, explainability: 25 } }).expect(200)).body;
      expect(ov.org.facts.authRepRequired).toBe(true);
      expect(ov.org.facts.authRep).toBe(false);
      ov = (await request(http).put('/api/v1/governance/eu/org').set(auth(o.owner)).send({ authorised_rep: { name: 'EU Rep GmbH', contact: 'rep@eurep.example', mandate_ref: 'DOC-MANDATE-1' } }).expect(200)).body;
      expect(ov.org.facts.authRep).toBe(true);
      expect(ov.models[0].roles).toEqual(expect.arrayContaining(['PROVIDER']));
    });
  });
});
