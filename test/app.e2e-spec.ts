import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

describe('SentrAI Console (e2e)', () => {
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

  it('health is public', async () => {
    const res = await request(http).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects protected routes without a token', async () => {
    await request(http).get('/api/v1/projects').expect(401);
  });

  it('exposes the 7 sutras publicly', async () => {
    const res = await request(http).get('/api/v1/sutras');
    expect(res.status).toBe(200);
    expect(res.body.sutras).toHaveLength(7);
  });

  it('runs the full governance happy path', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    // Org + tenant user
    const org = await request(http)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Acme Bank', description: 'test' });
    expect(org.status).toBe(201);
    const orgId = org.body.organization_id;

    const addUser = await request(http)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${admin}`)
      .send({ email: 'ops@acme.test', full_name: 'Ops', password: 'pw123456', role: 'ADMIN', organization_id: orgId });
    expect(addUser.status).toBe(201);

    const token = await login('ops@acme.test', 'pw123456');

    // Project (root_directory must exist on the server)
    const proj = await request(http)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Trading App', root_directory: process.cwd() });
    expect(proj.status).toBe(201);
    const projectId = proj.body.project_id;

    // Register a model — GenAI + credit + no oversight → triaged HIGH
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Credit Scorer',
        model_type: 'GENERATIVE_AI',
        functional_area: 'credit_underwriting',
        use_case_description: 'LLM scores SME credit applications end to end',
        human_oversight_required: false,
        board_policy_ref: '',
        project_id: projectId,
      });
    expect(model.status).toBe(201);
    expect(model.body.triaged_risk_level).toBe('HIGH');
    expect(model.body.compliance_pass).toBe(false);
    const modelId = model.body.model_id;

    // Compliance check
    const cc = await request(http).get(`/api/v1/inventory/models/${modelId}/compliance-check`).set('Authorization', `Bearer ${token}`);
    expect(cc.status).toBe(200);
    expect(cc.body.eu_ai_act.risk_tier).toBe('High Risk');
    expect(cc.body.nist_rmf.framework_name).toBe('NIST AI RMF');

    // Incident (P1 → 6h deadline)
    const inc = await request(http)
      .post('/api/v1/compliance/incident/report')
      .set('Authorization', `Bearer ${token}`)
      .send({
        model_id: modelId,
        model_name: 'Credit Scorer',
        re_name: 'Acme Bank',
        functional_area: 'credit_underwriting',
        incident_category: 'BIAS_DISCRIMINATION',
        severity: 'P1_CRITICAL',
        description: 'Model produced biased credit denials for a protected demographic segment repeatedly',
        observed_at: '2026-07-11T06:00:00Z',
        detected_at: '2026-07-11T06:30:00Z',
        model_risk_level: 'HIGH',
        immediate_action_taken: 'Suspended model and engaged rules fallback',
      });
    expect(inc.status).toBe(201);
    expect(inc.body.severity).toBe('P1_CRITICAL');

    // Drift → circuit breaker
    const drift = await request(http)
      .post('/api/v1/monitoring/drift/evaluate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        model_id: modelId,
        training_scores: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
        live_scores: [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4],
        baseline_accuracy: 0.9,
        current_accuracy: 0.7,
      });
    expect(drift.status).toBe(201);
    expect(drift.body.circuit_breaker_active).toBe(true);
    expect(drift.body.status).toBe('CIRCUIT_BREAKER_TRIPPED');

    // Audit initiate
    const audit = await request(http)
      .post(`/api/v1/audit/models/${modelId}/initiate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ auditor_ref: 'Internal', audit_type: 'INTERNAL', training_data_bias_checked: true, trust_verified: true, human_oversight_verified: true, fairness_metrics_passed: true, accountability_chain_documented: true, explainability_verified: true, bcp_verified: true });
    expect(audit.status).toBe(201);
    expect(audit.body.overall_verdict).toBe('COMPLIANT');

    // Metrics
    const metrics = await request(http).get('/metrics').set('Authorization', `Bearer ${token}`);
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain('sentrai_models_total 1');
    expect(metrics.text).toContain('sentrai_drift_alerts_total 1');

    // PDF export is public and returns a PDF
    const pdf = await request(http).get(`/api/v1/inventory/models/${modelId}/export-pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });

  it('enforces RBAC — non-admin cannot list users', async () => {
    // Register a plain VIEWER via the public register endpoint
    await request(http).post('/api/v1/auth/register').send({ email: 'viewer@x.test', full_name: 'V', password: 'pw123456', role: 'VIEWER' });
    const token = await login('viewer@x.test', 'pw123456');
    await request(http).get('/api/v1/users').set('Authorization', `Bearer ${token}`).expect(403);
  });
});
