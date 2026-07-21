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

  it('USERS: admin can change role, deactivate, and delete — with lockout guards', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    // Create a user.
    const created = await request(http)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${admin}`)
      .send({ email: 'crud@x.test', full_name: 'Crud User', password: 'pw12345678', role: 'VIEWER' });
    expect(created.status).toBe(201);
    const uid = created.body.user_id;
    expect(created.body.role).toBe('VIEWER');

    // Change role.
    const promoted = await request(http)
      .patch(`/api/v1/users/${uid}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ role: 'APPROVER' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.role).toBe('APPROVER');

    // Deactivate.
    const deactivated = await request(http)
      .patch(`/api/v1/users/${uid}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ is_active: false });
    expect(deactivated.body.is_active).toBe(false);

    // A deactivated user cannot log in.
    const blocked = await request(http).post('/api/v1/auth/token').type('form').send({ username: 'crud@x.test', password: 'pw12345678' });
    expect(blocked.status).toBe(403);

    // Guard: admin cannot demote or delete the last active admin (self).
    const meList = await request(http).get('/api/v1/users').set('Authorization', `Bearer ${admin}`);
    const adminRow = meList.body.find((u: any) => u.email === 'admin@sentrai.local');
    await request(http).patch(`/api/v1/users/${adminRow.user_id}`).set('Authorization', `Bearer ${admin}`).send({ role: 'VIEWER' }).expect(403);
    await request(http).delete(`/api/v1/users/${adminRow.user_id}`).set('Authorization', `Bearer ${admin}`).expect(403);

    // Delete the created user.
    await request(http).delete(`/api/v1/users/${uid}`).set('Authorization', `Bearer ${admin}`).expect(204);
    const after = await request(http).get('/api/v1/users').set('Authorization', `Bearer ${admin}`);
    expect(after.body.find((u: any) => u.email === 'crud@x.test')).toBeUndefined();
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
    // Scan-on-upload ran and persisted a result to the project.
    expect(upload.body.models_discovered).toBeGreaterThanOrEqual(1);
    const listed = await request(http).get('/api/v1/projects').set('Authorization', `Bearer ${admin}`);
    const projRow = listed.body.find((p: any) => p.project_id === projectId);
    expect(projRow.has_scan_result).toBe(true);
    expect(projRow.models_discovered).toBeGreaterThanOrEqual(1);

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

  it('accepts a folder upload (multiple files with relative paths)', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const proj = await request(http)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Folder App', description: 'folder onboarding' });
    const projectId = proj.body.project_id;

    // Files carry only basenames over multipart; the true relative paths ride
    // in a parallel `paths` field, matched by index (as the browser sends them).
    const upload = await request(http)
      .post(`/api/v1/projects/${projectId}/codebase/folder`)
      .set('Authorization', `Bearer ${admin}`)
      .attach('files', Buffer.from('import openai\n'), 'model.py')
      .attach('files', Buffer.from('# docs\n'), 'README.md')
      .attach('files', Buffer.from('junk'), 'index.js')
      .field('paths', 'myapp/model.py')
      .field('paths', 'myapp/README.md')
      .field('paths', 'myapp/node_modules/dep/index.js');
    expect(upload.status).toBe(201);
    expect(upload.body.source).toBe('folder');
    expect(upload.body.files_extracted).toBe(2); // node_modules skipped
    expect(upload.body.entries_skipped).toBe(1);
  });

  it('reports a clear error when a GitHub repo cannot be fetched', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const proj = await request(http)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'GitHub App', description: 'gh onboarding' });
    const projectId = proj.body.project_id;

    // A repo that does not exist should surface a 400, not crash.
    const res = await request(http)
      .post(`/api/v1/projects/${projectId}/codebase/github`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ owner: 'sentrai-nonexistent-org', repo: 'does-not-exist-xyz', branch: 'main' });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain('GitHub');
  });

  it('COMPLIANCE: portfolio rollup aggregates frameworks + plain-language gaps', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Rollup Credit Model',
        model_type: 'GENERATIVE_AI',
        functional_area: 'credit_underwriting',
        use_case_description: 'LLM credit underwriting assistant for retail lending decisions.',
      })
      .expect(201);

    const res = await request(http)
      .get('/api/v1/compliance/portfolio')
      .set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(res.body.summary.total_models).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.summary.headline).toBe('string');
    // All four frameworks are present with readiness sentences.
    const ids = res.body.frameworks.map((f: any) => f.id).sort();
    expect(ids).toEqual(['eu_ai_act', 'iso_42001', 'nist_ai_rmf', 'rbi_free_ai']);
    for (const f of res.body.frameworks) expect(typeof f.readiness).toBe('string');
    // A HIGH-risk credit model with no governance yields plain-language gaps.
    expect(res.body.top_gaps.length).toBeGreaterThan(0);
    expect(res.body.top_gaps[0].statement).toMatch(/model/i);

    // Readiness PDF renders.
    const pdf = await request(http)
      .get('/api/v1/compliance/portfolio/export-pdf')
      .set('Authorization', `Bearer ${admin}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.length).toBeGreaterThan(1000);
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

  it('TENANT ISOLATION: a user cannot scan or see another organization\'s project', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const AdmZip = (await import('adm-zip')).default;

    // Two orgs, one OWNER each.
    const mkOrg = async (name: string) => (await request(http)
      .post('/api/v1/organizations').set('Authorization', `Bearer ${admin}`)
      .send({ name })).body.organization_id;
    const orgA = await mkOrg('Org Alpha');
    const orgB = await mkOrg('Org Beta');
    await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
      .send({ email: 'owner@alpha.test', full_name: 'A', password: 'pw123456', role: 'OWNER', organization_id: orgA }).expect(201);
    await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
      .send({ email: 'owner@beta.test', full_name: 'B', password: 'pw123456', role: 'OWNER', organization_id: orgB }).expect(201);
    const tokenA = await login('owner@alpha.test', 'pw123456');
    const tokenB = await login('owner@beta.test', 'pw123456');

    const uploadProject = async (token: string, name: string, file: string) => {
      const p = await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${token}`).send({ name });
      const zip = new AdmZip();
      zip.addFile(file, Buffer.from('import openai\n\ndef run(x):\n    """LLM scoring."""\n    return openai.chat.completions.create(model="gpt-4", messages=[])\n'));
      await request(http).post(`/api/v1/projects/${p.body.project_id}/codebase`).set('Authorization', `Bearer ${token}`)
        .attach('file', zip.toBuffer(), 'c.zip').expect(201);
      return p.body; // { project_id, root_directory, ... }
    };
    const projA = await uploadProject(tokenA, 'Alpha App', 'alpha_svc/model.py');
    const projB = await uploadProject(tokenB, 'Beta App', 'beta_svc/model.py');

    // 1) B's project list shows only B's project.
    const bProjects = await request(http).get('/api/v1/projects').set('Authorization', `Bearer ${tokenB}`);
    expect(bProjects.body.map((p: any) => p.project_id)).toEqual([projB.project_id]);

    // 2) B scanning B's own project reads B's workspace.
    const bScan = await request(http).post('/api/v1/discovery/scan').set('Authorization', `Bearer ${tokenB}`)
      .send({ project_id: projB.project_id });
    expect(bScan.status).toBe(201);
    expect(bScan.body.directory).toBe(projB.root_directory);

    // 3) THE LEAK, fixed: B spoofs A's workspace path — it is IGNORED; the scan
    //    still resolves to B's own project workspace, never A's.
    const spoof = await request(http).post('/api/v1/discovery/scan').set('Authorization', `Bearer ${tokenB}`)
      .send({ project_id: projB.project_id, directory: projA.root_directory });
    expect(spoof.status).toBe(201);
    expect(spoof.body.directory).toBe(projB.root_directory);
    expect(spoof.body.directory).not.toBe(projA.root_directory);

    // 4) B cannot scan A's project by id (cross-org → 403).
    await request(http).post('/api/v1/discovery/scan').set('Authorization', `Bearer ${tokenB}`)
      .send({ project_id: projA.project_id }).expect(403);

    // 5) B cannot point a raw directory scan at A's workspace (needs a project).
    await request(http).post('/api/v1/discovery/scan').set('Authorization', `Bearer ${tokenB}`)
      .send({ directory: projA.root_directory }).expect(403);

    // 6) B cannot import candidates into A's project.
    await request(http).post('/api/v1/discovery/import').set('Authorization', `Bearer ${tokenB}`)
      .send({ project_id: projA.project_id, file_paths: ['alpha_svc/model.py'] }).expect(403);
  });

  it('SECURITY: a scanned hardcoded secret survives import — model is HIGH risk and keeps the finding', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const AdmZip = (await import('adm-zip')).default;

    const p = await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Secret Repo' });
    const projectId = p.body.project_id;
    // Rules-based file (no ML/LLM signals) → the scanner's risk hint is LOW …
    // … but it carries a hardcoded credential that must elevate the saved model.
    const zip = new AdmZip();
    zip.addFile('fin/portfolio_checkpoint.py', Buffer.from(
      '"""Core FinQuant portfolio checkpoint."""\n' +
      'api_key = "q7HgSuperSecret9t66"\n\n' +
      'def portfolio_decision_score(w, r):\n    return sum(a * b for a, b in zip(w, r))\n',
    ));
    await request(http).post(`/api/v1/projects/${projectId}/codebase`).set('Authorization', `Bearer ${admin}`)
      .attach('file', zip.toBuffer(), 'c.zip').expect(201);

    // Scan detects the secret; the static risk hint alone is only LOW.
    const scan = await request(http).post('/api/v1/discovery/scan').set('Authorization', `Bearer ${admin}`)
      .send({ project_id: projectId }).expect(201);
    const cand = scan.body.candidates.find((c: any) => c.file_path === 'fin/portfolio_checkpoint.py');
    expect(cand).toBeDefined();
    expect(cand.risk_hint).toBe('LOW');
    expect(cand.secrets).toHaveLength(1);

    // Import: the finding is carried over AND the model is floored at HIGH.
    const imported = await request(http).post('/api/v1/discovery/import').set('Authorization', `Bearer ${admin}`)
      .send({ project_id: projectId, file_paths: ['fin/portfolio_checkpoint.py'], overwrite: true }).expect(201);
    const modelId = imported.body[0].model_id;
    expect(imported.body[0].risk_level).toBe('HIGH');

    const list = await request(http).get(`/api/v1/inventory/models?project_id=${projectId}`)
      .set('Authorization', `Bearer ${admin}`).expect(200);
    const saved = list.body.find((m: any) => m.model_id === modelId);
    expect(saved.risk_level).toBe('HIGH');
    expect(saved.security_findings).toHaveLength(1);
    expect(saved.security_findings[0].type).toBe('Generic Secret Key');
    expect(saved.security_findings[0].masked_value).not.toContain('SuperSecret'); // value is masked

    // An unrelated governance edit re-triages the model, but the unremediated
    // secret keeps it floored at HIGH — it must not silently drop to LOW.
    await request(http).patch(`/api/v1/inventory/models/${modelId}/governance`).set('Authorization', `Bearer ${admin}`)
      .send({ owner_team: 'Risk', actor: 'test' }).expect(200);
    const after = await request(http).get(`/api/v1/inventory/models?project_id=${projectId}`)
      .set('Authorization', `Bearer ${admin}`).expect(200);
    expect(after.body.find((m: any) => m.model_id === modelId).risk_level).toBe('HIGH');
  });

  it('AI SUMMARY: heuristic summariser rewrites the description with reviewable provenance', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    const reg = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Zoo Signal Engine',
        model_type: 'RULES_BASED',
        functional_area: 'trading_signal_generation',
        use_case_description: 'Composite signal engine over ``Alpha Zoo`` factors. Unlike ``example_signal_engine`` (per-symbol API that takes ``dict[code, OHLCV]``), this consumes a registry.',
      }).expect(201);
    const modelId = reg.body.model_id;
    // A freshly registered model's description is human-entered, not AI/auto.
    expect(reg.body.description_source).toBe('static');

    const sum = await request(http).post(`/api/v1/inventory/models/${modelId}/summarize`)
      .set('Authorization', `Bearer ${admin}`).expect(200);
    expect(sum.body.ai_enabled).toBe(false); // no key configured in tests → local heuristic
    expect(sum.body.description_source).toBe('heuristic');
    expect(sum.body.description_model).toBeNull();
    // Reframed, not a verbatim copy: code jargon is stripped, governance framing added.
    expect(sum.body.summary).toContain('Zoo Signal Engine');
    expect(sum.body.summary).not.toContain('dict[code');
    expect(sum.body.summary).toMatch(/review and confirm/i);

    // Provenance is persisted and surfaced on the model.
    const list = await request(http).get('/api/v1/inventory/models').set('Authorization', `Bearer ${admin}`).expect(200);
    const saved = list.body.find((m: any) => m.model_id === modelId);
    expect(saved.description_source).toBe('heuristic');

    // A human edit flips provenance to 'human'.
    await request(http).patch(`/api/v1/inventory/models/${modelId}/governance`).set('Authorization', `Bearer ${admin}`)
      .send({ use_case_description: 'Combines quant signals into one trade-ranking score.', actor: 'test' }).expect(200);
    const after = await request(http).get('/api/v1/inventory/models').set('Authorization', `Bearer ${admin}`).expect(200);
    expect(after.body.find((m: any) => m.model_id === modelId).description_source).toBe('human');
  });

  it('AI PROVIDERS: org registry — CRUD with masked keys, tenant isolation, per-org precedence', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const SECRET_KEY = 'sk-secret-test-12345-do-not-leak';

    // A local mock OpenAI-compatible server — no real API is ever called.
    const httpMod = await import('http');
    let lastAuthHeader = '';
    const mock = httpMod.createServer((req, res) => {
      let body = '';
      req.on('data', (c: any) => (body += c));
      req.on('end', () => {
        lastAuthHeader = String(req.headers['authorization'] ?? '');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: 'MOCK-LLM: governed summary output.' } }] }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
    const mockPort = (mock.address() as any).port;

    try {
      // Two orgs, one OWNER each.
      const mkOrg = async (name: string) => (await request(http)
        .post('/api/v1/organizations').set('Authorization', `Bearer ${admin}`).send({ name })).body.organization_id;
      const orgA = await mkOrg('AI Org Alpha');
      const orgB = await mkOrg('AI Org Beta');
      await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
        .send({ email: 'ai-owner@alpha.test', full_name: 'A', password: 'pw123456', role: 'OWNER', organization_id: orgA }).expect(201);
      await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
        .send({ email: 'ai-owner@beta.test', full_name: 'B', password: 'pw123456', role: 'OWNER', organization_id: orgB }).expect(201);
      await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
        .send({ email: 'ai-viewer@alpha.test', full_name: 'V', password: 'pw123456', role: 'VIEWER', organization_id: orgA }).expect(201);
      const ownerA = await login('ai-owner@alpha.test', 'pw123456');
      const ownerB = await login('ai-owner@beta.test', 'pw123456');
      const viewerA = await login('ai-viewer@alpha.test', 'pw123456');

      // VIEWER cannot touch the registry — data egress is a governance decision.
      await request(http).get('/api/v1/ai/providers').set('Authorization', `Bearer ${viewerA}`).expect(403);

      // OWNER A registers a provider pointing at the mock.
      const created = await request(http).post('/api/v1/ai/providers').set('Authorization', `Bearer ${ownerA}`)
        .send({
          label: 'Mock LLM', adapter: 'openai-compat',
          base_url: `http://127.0.0.1:${mockPort}/v1`, model: 'mock-1', api_key: SECRET_KEY,
        }).expect(201);
      const providerId = created.body.provider_id;
      // The key NEVER comes back — only a mask.
      expect(JSON.stringify(created.body)).not.toContain(SECRET_KEY);
      expect(created.body.has_api_key).toBe(true);
      expect(created.body.api_key_masked).toContain('…');
      expect(created.body.local_endpoint).toBe(true); // 127.0.0.1 = on-box

      // Tenant isolation: B sees nothing and cannot reach A's config by id.
      const bList = await request(http).get('/api/v1/ai/providers').set('Authorization', `Bearer ${ownerB}`).expect(200);
      expect(bList.body).toHaveLength(0);
      await request(http).patch(`/api/v1/ai/providers/${providerId}`).set('Authorization', `Bearer ${ownerB}`)
        .send({ label: 'hijack' }).expect(404);
      await request(http).delete(`/api/v1/ai/providers/${providerId}`).set('Authorization', `Bearer ${ownerB}`).expect(404);

      // Connection test round-trips the DECRYPTED key to the provider.
      const test = await request(http).post(`/api/v1/ai/providers/${providerId}/test`)
        .set('Authorization', `Bearer ${ownerA}`).expect(200);
      expect(test.body.status).toBe('ok');
      expect(typeof test.body.latency_ms).toBe('number');
      expect(lastAuthHeader).toBe(`Bearer ${SECRET_KEY}`);

      // Precedence: org A's summarize goes through its registered provider…
      const regA = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${ownerA}`)
        .send({ name: 'Alpha Scorer', model_type: 'MACHINE_LEARNING', functional_area: 'risk_scoring', use_case_description: 'scores things' }).expect(201);
      const sumA = await request(http).post(`/api/v1/inventory/models/${regA.body.model_id}/summarize`)
        .set('Authorization', `Bearer ${ownerA}`).expect(200);
      expect(sumA.body.ai_enabled).toBe(true);
      expect(sumA.body.summary).toBe('MOCK-LLM: governed summary output.');
      expect(sumA.body.description_source).toBe('ai');
      expect(sumA.body.description_model).toBe('mock-1');
      expect(sumA.body.provider).toContain('Mock LLM');

      // …while org B (no provider) falls back to the local heuristic.
      const regB = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${ownerB}`)
        .send({ name: 'Beta Scorer', model_type: 'MACHINE_LEARNING', functional_area: 'risk_scoring', use_case_description: 'scores things too' }).expect(201);
      const sumB = await request(http).post(`/api/v1/inventory/models/${regB.body.model_id}/summarize`)
        .set('Authorization', `Bearer ${ownerB}`).expect(200);
      expect(sumB.body.ai_enabled).toBe(false);
      expect(sumB.body.description_source).toBe('heuristic');

      // Disabled providers are never selected — A drops back to the heuristic.
      await request(http).patch(`/api/v1/ai/providers/${providerId}`).set('Authorization', `Bearer ${ownerA}`)
        .send({ enabled: false }).expect(200);
      const sumA2 = await request(http).post(`/api/v1/inventory/models/${regA.body.model_id}/summarize`)
        .set('Authorization', `Bearer ${ownerA}`).expect(200);
      expect(sumA2.body.ai_enabled).toBe(false);
    } finally {
      await new Promise<void>((r) => mock.close(() => r()));
    }
  });

  it('PROMPT VAULT: versioned org templates — validation, history, restore, reset, and reaching the LLM', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    // Mock LLM that records the prompt it was sent.
    const httpMod = await import('http');
    let lastPrompt = '';
    const mock = httpMod.createServer((req, res) => {
      let body = '';
      req.on('data', (c: any) => (body += c));
      req.on('end', () => {
        try { lastPrompt = JSON.parse(body)?.messages?.[0]?.content ?? ''; } catch { lastPrompt = ''; }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: 'VAULT-MOCK output.' } }] }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
    const mockPort = (mock.address() as any).port;

    try {
      const mkOrg = async (name: string) => (await request(http)
        .post('/api/v1/organizations').set('Authorization', `Bearer ${admin}`).send({ name })).body.organization_id;
      const orgA = await mkOrg('Vault Org A');
      const orgB = await mkOrg('Vault Org B');
      await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
        .send({ email: 'vault-a@x.test', full_name: 'VA', password: 'pw123456', role: 'CISO', organization_id: orgA }).expect(201);
      await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
        .send({ email: 'vault-b@x.test', full_name: 'VB', password: 'pw123456', role: 'CISO', organization_id: orgB }).expect(201);
      const cisoA = await login('vault-a@x.test', 'pw123456');
      const cisoB = await login('vault-b@x.test', 'pw123456');

      // Defaults: all four use cases listed, none customized.
      const defaults = await request(http).get('/api/v1/ai/prompts').set('Authorization', `Bearer ${cisoA}`).expect(200);
      expect(defaults.body.map((p: any) => p.use_case).sort())
        .toEqual(['exec_narrative', 'gap_remediation', 'model_summary', 'risk_rationale']);
      expect(defaults.body.every((p: any) => p.customized === false)).toBe(true);

      // Validation: dropping a required variable is a hard 400…
      await request(http).put('/api/v1/ai/prompts/model_summary').set('Authorization', `Bearer ${cisoA}`)
        .send({ body: 'Summarize something without the model name.' }).expect(400);
      // …an unknown variable is a warning, not a block.
      const warned = await request(http).put('/api/v1/ai/prompts/model_summary').set('Authorization', `Bearer ${cisoA}`)
        .send({ body: 'CUSTOM-VAULT-PROMPT for {{name}} with {{tyop}}.' }).expect(200);
      expect(warned.body.version).toBe(1);
      expect(warned.body.warnings[0]).toContain('{{tyop}}');

      // v2 becomes active; history shows both, newest first.
      const v2 = await request(http).put('/api/v1/ai/prompts/model_summary').set('Authorization', `Bearer ${cisoA}`)
        .send({ body: 'CUSTOM-VAULT-PROMPT-V2 for {{name}} ({{model_type}}).', change_note: 'tightened' }).expect(200);
      expect(v2.body.version).toBe(2);
      const hist = await request(http).get('/api/v1/ai/prompts/model_summary/history').set('Authorization', `Bearer ${cisoA}`).expect(200);
      expect(hist.body.map((h: any) => h.version)).toEqual([2, 1]);
      expect(hist.body[0].active).toBe(true);
      expect(hist.body[0].change_note).toBe('tightened');

      // Tenant isolation: org B still sees the pristine default.
      const bList = await request(http).get('/api/v1/ai/prompts').set('Authorization', `Bearer ${cisoB}`).expect(200);
      expect(bList.body.find((p: any) => p.use_case === 'model_summary').customized).toBe(false);

      // The custom template actually reaches the provider: register a provider
      // for org A, summarize, and inspect the prompt the mock received.
      await request(http).post('/api/v1/ai/providers').set('Authorization', `Bearer ${cisoA}`)
        .send({ label: 'Vault Mock', adapter: 'openai-compat', base_url: `http://127.0.0.1:${mockPort}/v1`, model: 'vm-1' }).expect(201);
      const reg = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${cisoA}`)
        .send({ name: 'Vaulted Scorer', model_type: 'MACHINE_LEARNING', functional_area: 'risk_scoring', use_case_description: 'scores' }).expect(201);
      await request(http).post(`/api/v1/inventory/models/${reg.body.model_id}/summarize`)
        .set('Authorization', `Bearer ${cisoA}`).expect(200);
      expect(lastPrompt).toContain('CUSTOM-VAULT-PROMPT-V2 for Vaulted Scorer (MACHINE_LEARNING).');

      // Restore v1 → lands as v3 with v1's body; then reset → default applies.
      const restored = await request(http).post('/api/v1/ai/prompts/model_summary/restore/1')
        .set('Authorization', `Bearer ${cisoA}`).send({}).expect(200);
      expect(restored.body.version).toBe(3);
      await request(http).post('/api/v1/ai/prompts/model_summary/reset').set('Authorization', `Bearer ${cisoA}`).send({}).expect(200);
      const after = await request(http).get('/api/v1/ai/prompts').set('Authorization', `Bearer ${cisoA}`).expect(200);
      const ms = after.body.find((p: any) => p.use_case === 'model_summary');
      expect(ms.customized).toBe(false);
      expect(ms.version_count).toBe(3); // history preserved through reset

      // After reset, the DEFAULT prompt drives the next generation.
      await request(http).post(`/api/v1/inventory/models/${reg.body.model_id}/summarize`)
        .set('Authorization', `Bearer ${cisoA}`).expect(200);
      expect(lastPrompt).toContain('You are an AI-governance analyst.');
      expect(lastPrompt).not.toContain('CUSTOM-VAULT-PROMPT');
    } finally {
      await new Promise<void>((r) => mock.close(() => r()));
    }
  });

  it('AI DRAFTS: signals reach the summary prompt; rationale + remediation carry provenance', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const AdmZip = (await import('adm-zip')).default;

    const httpMod = await import('http');
    let lastPrompt = '';
    const mock = httpMod.createServer((req, res) => {
      let body = '';
      req.on('data', (c: any) => (body += c));
      req.on('end', () => {
        try { lastPrompt = JSON.parse(body)?.messages?.[0]?.content ?? ''; } catch { lastPrompt = ''; }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: 'DRAFT-MOCK output.' } }] }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
    const mockPort = (mock.address() as any).port;

    try {
      const orgId = (await request(http).post('/api/v1/organizations').set('Authorization', `Bearer ${admin}`)
        .send({ name: 'Draft Org' })).body.organization_id;
      await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
        .send({ email: 'draft@x.test', full_name: 'D', password: 'pw123456', role: 'CISO', organization_id: orgId }).expect(201);
      const ciso = await login('draft@x.test', 'pw123456');
      await request(http).post('/api/v1/ai/providers').set('Authorization', `Bearer ${ciso}`)
        .send({ label: 'Draft Mock', adapter: 'openai-compat', base_url: `http://127.0.0.1:${mockPort}/v1`, model: 'dm-1' }).expect(201);

      // Import a model whose file produces both an LLM signal and a secret.
      const p = await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${ciso}`).send({ name: 'Draft Repo' });
      const zip = new AdmZip();
      zip.addFile('svc/llm_scorer.py', Buffer.from(
        'import openai\napi_key = "sk-fake-secret-abcdef1234"\n\ndef credit_score(x):\n    """LLM credit scorer."""\n    return openai.chat.completions.create(model="gpt-4", messages=[])\n',
      ));
      await request(http).post(`/api/v1/projects/${p.body.project_id}/codebase`).set('Authorization', `Bearer ${ciso}`)
        .attach('file', zip.toBuffer(), 'c.zip').expect(201);
      await request(http).post('/api/v1/discovery/scan').set('Authorization', `Bearer ${ciso}`)
        .send({ project_id: p.body.project_id }).expect(201);
      const imported = await request(http).post('/api/v1/discovery/import').set('Authorization', `Bearer ${ciso}`)
        .send({ project_id: p.body.project_id, file_paths: ['svc/llm_scorer.py'], overwrite: true }).expect(201);
      const modelId = imported.body[0].model_id;

      // detectionSignals persisted and surfaced.
      const list = await request(http).get(`/api/v1/inventory/models?project_id=${p.body.project_id}`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      const saved = list.body.find((m: any) => m.model_id === modelId);
      expect(saved.detection_signals.length).toBeGreaterThan(0);

      // (1) Summary prompt now carries the real signals.
      await request(http).post(`/api/v1/inventory/models/${modelId}/summarize`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(lastPrompt).toContain('Static-analysis signals:');
      for (const sig of saved.detection_signals.slice(0, 2)) expect(lastPrompt).toContain(sig);

      // (2) Risk rationale: persisted with 'ai' provenance; prompt grounded in
      // the engine's factors (risk level + the secret-floor explanation).
      const rat = await request(http).post(`/api/v1/inventory/models/${modelId}/risk-rationale`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(rat.body.risk_rationale).toBe('DRAFT-MOCK output.');
      expect(rat.body.risk_rationale_source).toBe('ai');
      expect(lastPrompt).toContain('HIGH');
      expect(lastPrompt).toContain('hardcoded secret');
      expect(lastPrompt).not.toContain('sk-fake-secret-abcdef1234'); // secrets never leave

      // Human edit flips rationale provenance to 'human'.
      await request(http).patch(`/api/v1/inventory/models/${modelId}/governance`).set('Authorization', `Bearer ${ciso}`)
        .send({ risk_rationale: 'Confirmed: HIGH due to credit decisioning + secret in source.', actor: 'test' }).expect(200);
      const after = await request(http).get(`/api/v1/inventory/models?project_id=${p.body.project_id}`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(after.body.find((m: any) => m.model_id === modelId).risk_rationale_source).toBe('human');

      // (3) Remediation draft: per-gap lines reach the provider; not persisted.
      const rem = await request(http).post(`/api/v1/inventory/models/${modelId}/draft-remediation`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(rem.body.open_gaps).toBeGreaterThan(0);
      expect(rem.body.draft).toBe('DRAFT-MOCK output.');
      expect(lastPrompt).toContain('[RBI FREE-AI]');
      expect(lastPrompt).toContain('Open gaps:');

      // Heuristic fallback: disable the provider — drafts still work, labeled.
      const provs = await request(http).get('/api/v1/ai/providers').set('Authorization', `Bearer ${ciso}`).expect(200);
      await request(http).patch(`/api/v1/ai/providers/${provs.body[0].provider_id}`).set('Authorization', `Bearer ${ciso}`)
        .send({ enabled: false }).expect(200);
      const hRat = await request(http).post(`/api/v1/inventory/models/${modelId}/risk-rationale`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(hRat.body.risk_rationale_source).toBe('heuristic');
      expect(hRat.body.risk_rationale).toContain('classified HIGH risk');
      const hRem = await request(http).post(`/api/v1/inventory/models/${modelId}/draft-remediation`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(hRem.body.draft_source).toBe('heuristic');
      expect(hRem.body.draft).toContain('→ Action:');
    } finally {
      await new Promise<void>((r) => mock.close(() => r()));
    }
  });

  it('AI GOVERNANCE: configured LLM self-registers in inventory; usage metered; breaker trips', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const httpMod = await import('http');

    // Mock that reports token usage — and can be switched into failure mode.
    let failMode = false;
    let hits = 0;
    const mock = httpMod.createServer((req, res) => {
      let body = '';
      req.on('data', (c: any) => (body += c));
      req.on('end', () => {
        hits++;
        res.setHeader('content-type', 'application/json');
        if (failMode) { res.statusCode = 500; res.end('{"error":"boom"}'); return; }
        res.end(JSON.stringify({
          choices: [{ message: { content: 'METER-MOCK output.' } }],
          usage: { prompt_tokens: 111, completion_tokens: 22 },
        }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
    const mockPort = (mock.address() as any).port;

    try {
      const orgId = (await request(http).post('/api/v1/organizations').set('Authorization', `Bearer ${admin}`)
        .send({ name: 'Meter Org' })).body.organization_id;
      await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
        .send({ email: 'meter@x.test', full_name: 'M', password: 'pw123456', role: 'CISO', organization_id: orgId }).expect(201);
      const ciso = await login('meter@x.test', 'pw123456');

      // Creating a provider SELF-REGISTERS the LLM in the org's own inventory.
      const created = await request(http).post('/api/v1/ai/providers').set('Authorization', `Bearer ${ciso}`)
        .send({ label: 'Meter Mock', adapter: 'openai-compat', base_url: `http://127.0.0.1:${mockPort}/v1`, model: 'mm-1' }).expect(201);
      expect(created.body.linked_model_id).toBeTruthy();
      const inv = await request(http).get('/api/v1/inventory/models').set('Authorization', `Bearer ${ciso}`).expect(200);
      const selfModel = inv.body.find((m: any) => m.model_id === created.body.linked_model_id);
      expect(selfModel).toBeDefined(); // visible to the org (lives in its Governance Tooling project)
      expect(selfModel.name).toBe('LLM: Meter Mock');
      expect(selfModel.compliance_pass).toBe(false); // a governance obligation, like any model

      // A summarize call is metered with the provider-reported token counts.
      const reg = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${ciso}`)
        .send({ name: 'Metered Scorer', model_type: 'MACHINE_LEARNING', functional_area: 'risk_scoring', use_case_description: 'scores' }).expect(201);
      await request(http).post(`/api/v1/inventory/models/${reg.body.model_id}/summarize`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      const usage1 = await request(http).get('/api/v1/ai/usage').set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(usage1.body.total_calls).toBe(1);
      expect(usage1.body.tokens_in).toBe(111);
      expect(usage1.body.tokens_out).toBe(22);
      expect(usage1.body.recent[0].use_case).toBe('model_summary');
      expect(usage1.body.recent[0].actor).toBe('meter@x.test');

      // Circuit breaker: 3 consecutive failures open it; the 4th call doesn't
      // even reach the provider and degrades to the labeled heuristic.
      failMode = true;
      for (let i = 0; i < 3; i++) {
        const r = await request(http).post(`/api/v1/inventory/models/${reg.body.model_id}/risk-rationale`)
          .set('Authorization', `Bearer ${ciso}`).expect(200);
        expect(r.body.risk_rationale_source).toBe('heuristic'); // failed → fell back
      }
      const hitsAfterFailures = hits;
      const r4 = await request(http).post(`/api/v1/inventory/models/${reg.body.model_id}/risk-rationale`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(r4.body.risk_rationale_source).toBe('heuristic');
      expect(hits).toBe(hitsAfterFailures); // breaker open — provider NOT called

      // Failures were metered too — full reliability visibility.
      const usage2 = await request(http).get('/api/v1/ai/usage').set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(usage2.body.failed_calls).toBe(3);
      expect(usage2.body.ok_calls).toBe(1);

      // Deleting the provider retires (never deletes) the self-registered model.
      await request(http).delete(`/api/v1/ai/providers/${created.body.provider_id}`).set('Authorization', `Bearer ${ciso}`).expect(204);
      const invAfter = await request(http).get('/api/v1/inventory/models').set('Authorization', `Bearer ${ciso}`).expect(200);
      expect(invAfter.body.find((m: any) => m.model_id === created.body.linked_model_id)).toBeUndefined(); // inactive
      const ledger = await request(http).get(`/api/v1/inventory/models/${created.body.linked_model_id}/ledger`)
        .set('Authorization', `Bearer ${ciso}`).expect(200);
      const events = (ledger.body.events ?? ledger.body).map((e: any) => e.event_type ?? e.eventType);
      expect(events).toContain('MODEL_DECOMMISSIONED'); // history preserved
    } finally {
      await new Promise<void>((r) => mock.close(() => r()));
    }
  });

  it('MATRIX: fleet endpoint returns per-model framework verdicts + gaps, tenant-scoped', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const orgId = (await request(http).post('/api/v1/organizations').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Matrix Org' })).body.organization_id;
    await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
      .send({ email: 'matrix@x.test', full_name: 'MX', password: 'pw123456', role: 'CISO', organization_id: orgId }).expect(201);
    const ciso = await login('matrix@x.test', 'pw123456');

    const p = await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${ciso}`).send({ name: 'Matrix Proj' });
    const reg = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${ciso}`)
      .send({ name: 'Matrix Scorer', model_type: 'MACHINE_LEARNING', functional_area: 'credit_underwriting', use_case_description: 'scores', project_id: p.body.project_id }).expect(201);

    const mx = await request(http).get('/api/v1/compliance/matrix').set('Authorization', `Bearer ${ciso}`).expect(200);
    // Tenant-scoped: exactly this org's model, with all four framework verdicts.
    expect(mx.body.components).toHaveLength(1);
    const row = mx.body.components[0];
    expect(row.model_id).toBe(reg.body.model_id);
    expect(Object.keys(row.frameworks).sort()).toEqual(['eu', 'iso', 'nist', 'rbi']);
    for (const f of Object.values<any>(row.frameworks)) expect(['ok', 'gap']).toContain(f.status);
    expect(['ok', 'warn', 'alert']).toContain(row.drift);
    // An ungoverned HIGH-risk model must surface HIGH-severity gaps with framework labels.
    const rowGaps = mx.body.gaps.filter((g: any) => g.model_id === row.model_id);
    expect(rowGaps.length).toBeGreaterThan(0);
    expect(rowGaps.every((g: any) => g.severity === 'HIGH')).toBe(true);
    expect(new Set(rowGaps.map((g: any) => g.framework)).size).toBeGreaterThan(1);
  });

  it('RBAC: an OWNER administers only their own org and cannot mint ADMINs', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');
    const mkOrg = async (name: string) => (await request(http)
      .post('/api/v1/organizations').set('Authorization', `Bearer ${admin}`).send({ name })).body.organization_id;
    const orgX = await mkOrg('Org X');
    const orgY = await mkOrg('Org Y');

    await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
      .send({ email: 'owner@x.test', full_name: 'OX', password: 'pw123456', role: 'OWNER', organization_id: orgX }).expect(201);
    const yUser = await request(http).post('/api/v1/users').set('Authorization', `Bearer ${admin}`)
      .send({ email: 'viewer@y.test', full_name: 'VY', password: 'pw123456', role: 'VIEWER', organization_id: orgY });
    const ownerX = await login('owner@x.test', 'pw123456');

    // OWNER creates a user — org is forced to their own (the passed orgY is ignored),
    // and CISO is within an OWNER's ceiling.
    const created = await request(http).post('/api/v1/users').set('Authorization', `Bearer ${ownerX}`)
      .send({ email: 'ciso@x.test', full_name: 'CX', password: 'pw123456', role: 'CISO', organization_id: orgY });
    expect(created.status).toBe(201);
    expect(created.body.organization_id).toBe(orgX);
    expect(created.body.role).toBe('CISO');

    // OWNER cannot mint an ADMIN (create or promote).
    await request(http).post('/api/v1/users').set('Authorization', `Bearer ${ownerX}`)
      .send({ email: 'a2@x.test', full_name: 'A2', password: 'pw123456', role: 'ADMIN' }).expect(403);
    await request(http).patch(`/api/v1/users/${created.body.user_id}`).set('Authorization', `Bearer ${ownerX}`)
      .send({ role: 'ADMIN' }).expect(403);

    // OWNER's user list is org-scoped — no global admin, no other org.
    const list = await request(http).get('/api/v1/users').set('Authorization', `Bearer ${ownerX}`);
    const emails = list.body.map((u: any) => u.email);
    expect(emails).toContain('owner@x.test');
    expect(emails).toContain('ciso@x.test');
    expect(emails).not.toContain('admin@sentrai.local');
    expect(emails).not.toContain('viewer@y.test');

    // OWNER cannot manage another org's user.
    await request(http).patch(`/api/v1/users/${yUser.body.user_id}`).set('Authorization', `Bearer ${ownerX}`)
      .send({ role: 'REVIEWER' }).expect(403);
    await request(http).delete(`/api/v1/users/${yUser.body.user_id}`).set('Authorization', `Bearer ${ownerX}`).expect(403);

    // Last-owner guard: even a global admin cannot demote the only OWNER of org X.
    const allUsers = await request(http).get('/api/v1/users').set('Authorization', `Bearer ${admin}`);
    const ownerRow = allUsers.body.find((u: any) => u.email === 'owner@x.test');
    await request(http).patch(`/api/v1/users/${ownerRow.user_id}`).set('Authorization', `Bearer ${admin}`)
      .send({ role: 'VIEWER' }).expect(403);
  });

  it('CI GATE: blocks a shadow-AI model and passes once it is governed', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    const proj = await request(http)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'CI Gate App', description: 'ci gate test' });
    const projectId = proj.body.project_id;

    // Mint a project-scoped CI service token.
    const tok = await request(http)
      .post('/api/v1/ci/tokens')
      .set('Authorization', `Bearer ${admin}`)
      .send({ project_id: projectId, label: 'ci-gate-test' });
    expect(tok.status).toBe(201);
    const ciToken = tok.body.token;
    expect(typeof ciToken).toBe('string');

    // Minting for a non-existent project fails clearly here, not later at scan time.
    await request(http)
      .post('/api/v1/ci/tokens')
      .set('Authorization', `Bearer ${admin}`)
      .send({ project_id: 'no-such-project', label: 'x' })
      .expect(404);

    // A policy that blocks any detected model of any severity that isn't governed.
    const policy = [
      'gates:',
      '  block_on:',
      '    - severity: LOW',
      '      missing: [registered, owner_team, board_policy_ref]',
      '    - severity: MEDIUM',
      '      missing: [registered, owner_team, board_policy_ref]',
      '    - severity: HIGH',
      '      missing: [registered, owner_team, board_policy_ref]',
      '  frameworks: [eu_ai_act]',
    ].join('\n');

    const modelCode =
      'import openai\n\n' +
      'def score_credit(applicant):\n' +
      '    """Credit underwriting via LLM."""\n' +
      '    return openai.chat.completions.create(model="gpt-4", messages=[])\n';

    const files = [
      { path: '.sentrai/policy.yaml', content: policy },
      { path: 'app/credit_model.py', content: modelCode },
    ];

    // 1) Shadow AI (no registered model) → FAIL, with SARIF + an audit record.
    const fail = await request(http)
      .post('/api/v1/ci/scan')
      .set('Authorization', `Bearer ${ciToken}`)
      .send({ commit_sha: 'abc123', pr_number: '7', files });
    expect(fail.status).toBe(200);
    expect(fail.body.verdict).toBe('fail');
    expect(fail.body.summary.shadow_assets).toBeGreaterThan(0);
    expect(fail.body.sarif.runs[0].results.length).toBeGreaterThan(0);
    expect(fail.body.gate_event_id).toBeTruthy();

    // The interactive JWT must NOT be accepted on the CI endpoint.
    await request(http)
      .post('/api/v1/ci/scan')
      .set('Authorization', `Bearer ${admin}`)
      .send({ commit_sha: 'x', files })
      .expect(401);

    // 2) Govern the model (matching source_ref) with owner + board policy.
    await request(http)
      .post('/api/v1/inventory/models')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Credit Model',
        model_type: 'GENERATIVE_AI',
        functional_area: 'credit_underwriting',
        use_case_description: 'LLM credit underwriting assistant for retail lending.',
        owner_team: 'Risk Analytics',
        board_policy_ref: 'BOARD-AI-POLICY-2026',
        source_ref: 'app/credit_model.py',
        project_id: projectId,
      })
      .expect(201);

    // 3) Same commit, now governed → PASS, no blocking violations.
    const pass = await request(http)
      .post('/api/v1/ci/scan')
      .set('Authorization', `Bearer ${ciToken}`)
      .send({ commit_sha: 'abc123', pr_number: '7', files });
    expect(pass.status).toBe(200);
    expect(pass.body.verdict).toBe('pass');
    expect(pass.body.blocking_violations.length).toBe(0);

    // 4) The immutable gate trail records both decisions, newest first.
    const history = await request(http)
      .get(`/api/v1/ci/projects/${projectId}/gate-history`)
      .set('Authorization', `Bearer ${admin}`);
    expect(history.status).toBe(200);
    expect(history.body.length).toBe(2);
    expect(history.body[0].verdict).toBe('pass');
    expect(history.body[1].verdict).toBe('fail');
  });

  it('CI LEDGER: org-wide events carry line-level evidence; override is additive (verdict preserved)', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    const proj = await request(http)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Ledger App', description: 'ledger test' });
    const projectId = proj.body.project_id;

    const tok = await request(http)
      .post('/api/v1/ci/tokens')
      .set('Authorization', `Bearer ${admin}`)
      .send({ project_id: projectId, label: 'ledger-test' });
    const ciToken = tok.body.token;

    const policy = [
      'gates:',
      '  block_on:',
      '    - severity: LOW',
      '      missing: [registered, owner_team]',
      '    - severity: MEDIUM',
      '      missing: [registered, owner_team]',
      '    - severity: HIGH',
      '      missing: [registered, owner_team]',
      '  frameworks: [eu_ai_act]',
    ].join('\n');
    // The rogue aliased import is exactly the kind of AST signal the viewer shows.
    const rogue =
      'from transformers import Pipeline as rogue_ai\n' +
      'import openai\n\n' +
      'def score_credit(applicant):\n' +
      '    """Credit underwriting via LLM."""\n' +
      '    clf = rogue_ai("text-classification")\n' +
      '    return openai.chat.completions.create(model="gpt-4", messages=[])\n';
    const files = [
      { path: '.sentrai/policy.yaml', content: policy },
      { path: 'svc/rogue.py', content: rogue },
    ];

    const fail = await request(http)
      .post('/api/v1/ci/scan')
      .set('Authorization', `Bearer ${ciToken}`)
      .send({ commit_sha: 'deadbeefcafe', pr_number: '42', files });
    expect(fail.status).toBe(200);
    expect(fail.body.verdict).toBe('fail');
    const eventId = fail.body.gate_event_id;

    // Org-wide ledger surfaces the event with line-level evidence for the viewer.
    const ledger = await request(http)
      .get('/api/v1/ci/events?verdict=fail')
      .set('Authorization', `Bearer ${admin}`);
    expect(ledger.status).toBe(200);
    const row = ledger.body.find((e: any) => e.gate_event_id === eventId);
    expect(row).toBeTruthy();
    expect(row.effective_verdict).toBe('fail');
    expect(row.project_name).toBe('Ledger App');
    const gap = row.blocking_violations[0];
    expect(Array.isArray(gap.evidence)).toBe(true);
    expect(gap.evidence.length).toBeGreaterThan(0);
    expect(gap.evidence[0]).toHaveProperty('line');
    expect(gap.evidence[0]).toHaveProperty('snippet');

    // A short justification is rejected.
    await request(http)
      .post(`/api/v1/ci/events/${eventId}/override`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ reason: 'ok' })
      .expect(400);

    // Auditor sign-off override.
    const ov = await request(http)
      .post(`/api/v1/ci/events/${eventId}/override`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ reason: 'Compensating control approved under ticket GRC-123.' });
    expect(ov.status).toBe(200);
    expect(ov.body.overridden).toBe(true);
    expect(ov.body.overridden_by).toBe('admin@sentrai.local');
    // Immutability: the ORIGINAL verdict is preserved; only effective flips.
    expect(ov.body.verdict).toBe('fail');
    expect(ov.body.effective_verdict).toBe('pass');

    // Double-override is refused.
    await request(http)
      .post(`/api/v1/ci/events/${eventId}/override`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ reason: 'Trying to override again, should fail.' })
      .expect(403);

    // The immutable audit_events ledger captured the override action + actor.
    const audit = await request(http)
      .get('/api/v1/audit/events?path=/override')
      .set('Authorization', `Bearer ${admin}`);
    expect(audit.status).toBe(200);
  });

  it('DRIFT: stored score windows evaluate on demand and trip the circuit breaker', async () => {
    const admin = await login('admin@sentrai.local', 'admin123');

    const proj = await request(http).post('/api/v1/projects').set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Drift App', description: 'drift test' });
    const projectId = proj.body.project_id;

    const model = await request(http).post('/api/v1/inventory/models').set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Collections Propensity',
        model_type: 'MACHINE_LEARNING',
        functional_area: 'collections',
        use_case_description: 'Scores repayment propensity for collections routing',
        human_oversight_required: true,
        board_policy_ref: 'BP-11',
        project_id: projectId,
      });
    const modelId = model.body.model_id;

    // With no windows pushed there is nothing to compare — a clear 400, not a crash.
    await request(http).post(`/api/v1/monitoring/drift/${modelId}/evaluate`)
      .set('Authorization', `Bearer ${admin}`).expect(400);

    // Reference clusters low, live clusters high: a large, unambiguous shift.
    const reference = Array.from({ length: 200 }, (_, i) => 0.20 + (i % 20) * 0.005);
    const live = Array.from({ length: 200 }, (_, i) => 0.70 + (i % 20) * 0.005);
    await request(http).post(`/api/v1/monitoring/scores/${modelId}`).set('Authorization', `Bearer ${admin}`)
      .send({ kind: 'reference', scores: reference, accuracy: 0.9 }).expect(201);
    await request(http).post(`/api/v1/monitoring/scores/${modelId}`).set('Authorization', `Bearer ${admin}`)
      .send({ kind: 'live', scores: live, accuracy: 0.78 }).expect(201);

    const evaluated = await request(http).post(`/api/v1/monitoring/drift/${modelId}/evaluate`)
      .set('Authorization', `Bearer ${admin}`);
    expect(evaluated.status).toBe(201);
    expect(evaluated.body.psi_score).toBeGreaterThan(0.2);
    expect(evaluated.body.accuracy_delta).toBeCloseTo(-0.12, 2);
    expect(evaluated.body.circuit_breaker_active).toBe(true);
    expect(evaluated.body.remediation_action).toBeTruthy();

    // The report is persisted and readable from history.
    const history = await request(http).get(`/api/v1/monitoring/drift/${modelId}/history`)
      .set('Authorization', `Bearer ${admin}`);
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].status).toBe(evaluated.body.status);
  });
});
