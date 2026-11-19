import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

/** Governance workflows page (W0 to W12): status read from the existing checks. */
describe('Governance workflows (e2e)', () => {
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
    const model = await request(http).post('/api/v1/inventory/models').set(auth(owner)).send({
      name: `${name} Credit`, model_type: 'MACHINE_LEARNING', functional_area: 'credit_underwriting', risk_level: 'HIGH',
      use_case_description: 'Scores SME credit applications for the underwriting team', human_oversight_required: true,
      board_policy_ref: 'BP-1', project_id: project.body.project_id, target_customer_segments: ['sme'],
    }).expect(201);
    return { admin, owner, viewer, orgId: org.body.organization_id, modelId: model.body.model_id };
  };

  const step = (view: any, id: string) => view.stages.flatMap((s: any) => s.steps).find((s: any) => s.id === id && !s.from_stage);

  it('works with governance off: basic steps only, no pack-driven steps', async () => {
    const o = await setupOrg('WfOff');
    const org = (await request(http).get('/api/v1/governance/workflows/org').set(auth(o.owner)).expect(200)).body;
    expect(org.jurisdiction.settings_available).toBe(false);
    expect(step(org, 'w1-1').status).toBe('done');
    expect(step(org, 'w0-2')).toBeUndefined(); // settings flag off
    const m = (await request(http).get(`/api/v1/governance/workflows/models/${o.modelId}`).set(auth(o.owner)).expect(200)).body;
    expect(m.model.id).toBe(o.modelId);
    expect(m.total).toBeGreaterThan(0);
    expect(step(m, 'w3-3')).toBeUndefined(); // impact assessment flag off
  });

  it('follows the jurisdiction, the settings and the same control checks as the compliance check', async () => {
    await withEnv({ GOVERNANCE_V2: 'true' }, async () => {
      const o = await setupOrg('WfOn');
      let org = (await request(http).get('/api/v1/governance/workflows/org').set(auth(o.owner)).expect(200)).body;
      expect(org.jurisdiction.is_default).toBe(true);
      expect(org.jurisdiction.can_edit).toBe(true);
      expect(step(org, 'w0-2').status).toBe('todo');
      expect(org.blockers.some((b: any) => b.step_id === 'w0-2')).toBe(true);
      expect(step(org, 'w11-4')).toBeUndefined(); // Australia only

      // A viewer reads the workflow but cannot change the jurisdiction.
      const asViewer = (await request(http).get('/api/v1/governance/workflows/org').set(auth(o.viewer)).expect(200)).body;
      expect(asViewer.jurisdiction.can_edit).toBe(false);

      // The jurisdiction prompt writes the real settings: Australia brings the DTA steps in.
      await request(http).put('/api/v1/governance/settings').set(auth(o.owner))
        .send({ settings: { primaryJurisdiction: 'AU', enabledPacks: ['au-dta'] }, reason: 'Set from the workflow jurisdiction prompt' }).expect(200);
      org = (await request(http).get('/api/v1/governance/workflows/org').set(auth(o.owner)).expect(200)).body;
      expect(org.jurisdiction.primary).toBe('AU');
      expect(org.jurisdiction.packs_in_force).toContain('au-dta');
      expect(step(org, 'w0-2').status).toBe('done');
      expect(step(org, 'w11-4')).toBeDefined();

      const m = (await request(http).get(`/api/v1/governance/workflows/models/${o.modelId}`).set(auth(o.owner)).expect(200)).body;
      expect(step(m, 'w1-10')).toBeDefined(); // DTA use-case register
      expect(step(m, 'w2-5')).toBeUndefined(); // RBI Sutras: pack not in force
      // Open gaps match the compliance check's in-scope verdict.
      const list = (await request(http).get('/api/v1/inventory/models').set(auth(o.owner)).expect(200)).body;
      const row = (list.models ?? list).find((x: any) => x.model_id === o.modelId);
      expect(step(m, 'w5-9').status === 'done').toBe(row.open_gap_count === 0);
      // No FINAL impact assessment yet, so W3.3 is not done and the deploy gate reports it.
      expect(step(m, 'w3-3').status).not.toBe('done');
      expect(m.next).toBeTruthy();

      const summary = (await request(http).get('/api/v1/governance/workflows/models').set(auth(o.owner)).expect(200)).body;
      expect(summary.models.map((x: any) => x.model_id)).toContain(o.modelId);

      // Another organisation's model is not disclosed.
      const other = await setupOrg('WfOther');
      await request(http).get(`/api/v1/governance/workflows/models/${o.modelId}`).set(auth(other.owner)).expect(404);
    });
  });
});
