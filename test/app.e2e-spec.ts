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

  it('SECURITY: public registration cannot self-assign a privileged role', async () => {
    // Attacker attempts to register directly as ADMIN.
    const reg = await request(http)
      .post('/api/v1/auth/register')
      .send({ email: 'attacker@x.test', full_name: 'Mallory', password: 'pw12345678', role: 'ADMIN' });
    expect(reg.status).toBe(201);
    expect(reg.body.role).toBe('VIEWER'); // role coerced, never ADMIN

    // And the resulting account has no admin powers.
    const token = await login('attacker@x.test', 'pw12345678');
    const me = await request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.role).toBe('VIEWER');
    await request(http).get('/api/v1/users').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('SECURITY: rejects weak registration passwords', async () => {
    await request(http)
      .post('/api/v1/auth/register')
      .send({ email: 'weak@x.test', full_name: 'W', password: 'short' })
      .expect(400);
  });

  it('gates lifecycle promotion on governance completeness', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Ungoverned Draft',
        model_type: 'MACHINE_LEARNING',
        functional_area: 'fraud_detection',
        use_case_description: 'Detects anomalous transactions in the payments stream',
        human_oversight_required: false,
      });
    expect(model.status).toBe(201);
    const modelId = model.body.model_id;

    // No owner / policy — promotion to DEPLOYED must 422 with the missing fields.
    const blocked = await request(http)
      .patch(`/api/v1/inventory/models/${modelId}/lifecycle`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ stage: 'DEPLOYED', actor: 'e2e' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.missing_fields.join(' ')).toContain('owner_team');

    // Complete governance, then promotion succeeds.
    await request(http)
      .patch(`/api/v1/inventory/models/${modelId}/governance`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ owner_team: 'Fraud Ops', board_policy_ref: 'POLICY-9', human_oversight_required: true, actor: 'e2e' })
      .expect(200);
    await request(http)
      .patch(`/api/v1/inventory/models/${modelId}/lifecycle`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ stage: 'DEPLOYED', actor: 'e2e' })
      .expect(200);
  });

  it('keeps the full ledger after a permanent purge, and restricts purging to admins', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Purge Candidate',
        model_type: 'NLP',
        functional_area: 'internal_tooling',
        use_case_description: 'Internal document summarizer for the ops team',
      });
    const modelId = model.body.model_id;

    // A non-admin cannot purge.
    const viewer = await login('viewer@x.test', 'pw123456');
    await request(http)
      .delete(`/api/v1/inventory/models/${modelId}?permanent=true`)
      .set('Authorization', `Bearer ${viewer}`)
      .expect(403);

    // Admin purge removes the model row but the ledger survives with a tombstone.
    await request(http)
      .delete(`/api/v1/inventory/models/${modelId}?permanent=true&actor=e2e-admin`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(204);

    const ledger = await request(http)
      .get(`/api/v1/inventory/models/${modelId}/ledger`)
      .set('Authorization', `Bearer ${admin}`);
    expect(ledger.status).toBe(200);
    const types = ledger.body.map((e: any) => e.event_type);
    expect(types).toContain('MODEL_REGISTERED');
    expect(types).toContain('MODEL_PURGED');
  });

  it('evaluates ingested score windows via the monitoring loop', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Windowed Model',
        model_type: 'MACHINE_LEARNING',
        functional_area: 'fraud_detection',
        use_case_description: 'Scores transactions for fraud with streaming inference',
      });
    const modelId = model.body.model_id;

    await request(http)
      .post(`/api/v1/monitoring/scores/${modelId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ kind: 'reference', scores: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], accuracy: 0.9 })
      .expect(201);
    await request(http)
      .post(`/api/v1/monitoring/scores/${modelId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ kind: 'live', scores: [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5], accuracy: 0.7 })
      .expect(201);

    // Run the same evaluation the hourly cron performs.
    const { MonitoringService } = await import('../src/monitoring/monitoring.service');
    const monitoring = app.get(MonitoringService);
    const result = await monitoring.evaluatePendingWindows();
    expect(result.evaluated).toBe(1);
    expect(result.tripped).toBe(1);

    const history = await request(http)
      .get(`/api/v1/monitoring/drift/${modelId}/history`)
      .set('Authorization', `Bearer ${admin}`);
    expect(history.status).toBe(200);
    expect(history.body.length).toBeGreaterThan(0);
    expect(history.body[0].circuit_breaker_active).toBe(true);

    // Windows are marked evaluated — a second pass is a no-op.
    const again = await monitoring.evaluatePendingWindows();
    expect(again.evaluated).toBe(0);
  });

  it('records masked audit events for every mutating action, including logins', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const events = await request(http)
      .get('/api/v1/audit/events?limit=200')
      .set('Authorization', `Bearer ${admin}`);
    expect(events.status).toBe(200);
    expect(events.body.length).toBeGreaterThan(0);

    const loginEvent = events.body.find((e: any) => e.path.includes('/auth/token'));
    expect(loginEvent).toBeDefined();
    // Credentials never appear in the audit sink un-masked.
    const raw = JSON.stringify(loginEvent.payload_summary ?? {});
    expect(raw).not.toContain('admin123');

    const registerEvent = events.body.find((e: any) => e.path.includes('/inventory/models') && e.method === 'POST');
    expect(registerEvent).toBeDefined();
  });

  it('attaches evidence artifacts and reflects them in compliance checks', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const model = await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Evidence Model',
        model_type: 'MACHINE_LEARNING',
        functional_area: 'credit_underwriting',
        use_case_description: 'Credit scoring model with documented bias testing evidence',
        owner_team: 'Risk',
        board_policy_ref: 'POLICY-2',
        human_oversight_required: true,
      });
    const modelId = model.body.model_id;

    await request(http)
      .post(`/api/v1/inventory/models/${modelId}/evidence`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ type: 'bias_test', ref: 'https://reports.example/bias-2026-q2.pdf', description: 'Quarterly bias audit' })
      .expect(201);

    const cc = await request(http)
      .get(`/api/v1/inventory/models/${modelId}/compliance-check`)
      .set('Authorization', `Bearer ${admin}`);
    expect(cc.status).toBe(200);
    const art10 = cc.body.eu_ai_act.checks.find((c: any) => c.control_code === 'Art-10');
    expect(art10.passed).toBe(true);

    const evidence = await request(http)
      .get(`/api/v1/inventory/models/${modelId}/evidence`)
      .set('Authorization', `Bearer ${admin}`);
    expect(evidence.body.evidence).toHaveLength(1);
  });

  it('accepts a codebase ZIP upload and scans it from the project workspace', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    // Project with no server path — it will scan its upload workspace.
    const proj = await request(http)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Uploaded App', description: 'zip onboarding' });
    expect(proj.status).toBe(201);
    const projectId = proj.body.project_id;
    expect(proj.body.root_directory).toContain(projectId);

    // Build a small in-memory zip containing an AI-looking source file plus
    // junk (node_modules) that the extractor must skip.
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip();
    zip.addFile('app/model.py', Buffer.from(
      'import openai\n\ndef score(candidate):\n    """LLM credit scoring."""\n    return openai.chat.completions.create(model="gpt-4", messages=[])\n',
    ));
    zip.addFile('app/README.md', Buffer.from('docs'));
    zip.addFile('node_modules/junk/index.js', Buffer.from('ignored'));

    const upload = await request(http)
      .post(`/api/v1/projects/${projectId}/codebase`)
      .set('Authorization', `Bearer ${admin}`)
      .attach('file', zip.toBuffer(), 'codebase.zip');
    expect(upload.status).toBe(201);
    expect(upload.body.files_extracted).toBe(2);
    expect(upload.body.entries_skipped).toBe(1);

    // The workspace is now scannable: rescan finds the project directory valid.
    const rescan = await request(http)
      .post('/api/v1/inventory/models/rescan')
      .set('Authorization', `Bearer ${admin}`)
      .send({ project_id: projectId });
    expect(rescan.status).toBe(200);

    // Rejects non-zip payloads.
    const bad = await request(http)
      .post(`/api/v1/projects/${projectId}/codebase`)
      .set('Authorization', `Bearer ${admin}`)
      .attach('file', Buffer.from('not a zip'), 'notes.txt');
    expect(bad.status).toBe(400);
  });

  it('reports plan usage with soft limits', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const org = await request(http)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Plan Test Org', description: 'usage test' });
    const orgId = org.body.organization_id;
    expect(org.body.plan).toBe('COMMUNITY');

    const usage = await request(http)
      .get(`/api/v1/inventory/organizations/${orgId}/usage`)
      .set('Authorization', `Bearer ${admin}`);
    expect(usage.status).toBe(200);
    expect(usage.body.plan).toBe('COMMUNITY');
    expect(usage.body.model_limit).toBe(10);
    expect(usage.body.over_limit).toBe(false);

    // Upgrade the plan; the limit expands.
    await request(http)
      .patch(`/api/v1/organizations/${orgId}/plan`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ plan: 'GROWTH' })
      .expect(200);
    const upgraded = await request(http)
      .get(`/api/v1/inventory/organizations/${orgId}/usage`)
      .set('Authorization', `Bearer ${admin}`);
    expect(upgraded.body.model_limit).toBe(100);
  });
});
