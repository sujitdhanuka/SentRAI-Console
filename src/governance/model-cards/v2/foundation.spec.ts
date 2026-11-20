import { checkConsistency, CONSISTENCY_RULE_CODES } from './consistency';
import { checkOwner, OwnerCandidate } from './owners';
import { relationAllows, suggestRecordType } from './record-types';

describe('model card v2: record types', () => {
  it('suggests MODEL_CONFIGURATION for a settings screen, whatever the scanner called it', () => {
    const s = suggestRecordType({
      name: 'Global Ai Model Settings', modelType: 'GENERATIVE_AI', detectionSignals: [], detectedTools: [],
      sourceRefs: ['acme-app/src/app/components/GlobalAiModelSettings.tsx'],
    });
    expect(s.type).toBe('MODEL_CONFIGURATION');
    expect(s.reasons.join(' ')).toContain('GENERATIVE_AI');
  });

  it('suggests AGENT on tool use and RAG_PIPELINE on retrieval signals', () => {
    expect(suggestRecordType({ name: 'Helper', modelType: 'NLP', sourceRefs: ['a.py'], detectionSignals: [], detectedTools: ['http_get'] }).type).toBe('AGENT');
    expect(suggestRecordType({ name: 'Docs search', modelType: 'NLP', sourceRefs: ['retriever.py'], detectionSignals: [], detectedTools: [] }).type).toBe('RAG_PIPELINE');
  });

  it('does not guess when nothing points at a type', () => {
    expect(suggestRecordType({ name: 'Scorer', modelType: 'MACHINE_LEARNING', sourceRefs: ['score.py'], detectionSignals: [], detectedTools: [] }).type).toBeNull();
  });

  it('limits what a relation may point to', () => {
    expect(relationAllows('selects_model', 'AI_MODEL')).toBe(true);
    expect(relationAllows('selects_model', 'MODEL_CONFIGURATION')).toBe(false);
    expect(relationAllows('selects_model', null)).toBe(false);
    expect(relationAllows('calls_tool', null)).toBe(true);
  });
});

describe('model card v2: state consistency (D2)', () => {
  const none = { componentLifecycle: null, modelLifecycle: null, deploymentStatus: null, operationalStatus: null } as const;

  it('flags DESIGN with ACTIVE, and NOT_DEPLOYED with ACTIVE (the v1 fixture)', () => {
    const codes = checkConsistency({ ...none, modelLifecycle: 'DESIGN', deploymentStatus: 'NOT_DEPLOYED', operationalStatus: 'ACTIVE' }).map((f) => f.code);
    expect(codes).toEqual(['STATE_PRE_DEPLOYMENT_ACTIVE', 'STATE_NOT_DEPLOYED_ACTIVE']);
  });

  it('accepts consistent combinations', () => {
    expect(checkConsistency({ componentLifecycle: 'RELEASED', modelLifecycle: 'DEPLOYED', deploymentStatus: 'DEPLOYED_PRODUCTION', operationalStatus: 'ACTIVE' })).toEqual([]);
    expect(checkConsistency({ ...none, modelLifecycle: 'DESIGN', deploymentStatus: 'NOT_DEPLOYED', operationalStatus: 'INACTIVE' })).toEqual([]);
  });

  it('never decides on a state that has not been assessed', () => {
    expect(checkConsistency({ ...none, operationalStatus: 'ACTIVE' })).toEqual([]);
    expect(checkConsistency(none)).toEqual([]);
  });

  it('catches every other contradiction', () => {
    const hit = (s: Partial<typeof none> | Record<string, string>) => checkConsistency({ ...none, ...(s as any) }).map((f) => f.code);
    expect(hit({ modelLifecycle: 'MONITORING', deploymentStatus: 'NOT_DEPLOYED' })).toContain('STATE_LIVE_NOT_DEPLOYED');
    expect(hit({ modelLifecycle: 'DEVELOPMENT', deploymentStatus: 'DEPLOYED_PRODUCTION' })).toContain('STATE_PRODUCTION_BEFORE_VALIDATION');
    expect(hit({ modelLifecycle: 'DECOMMISSIONED', operationalStatus: 'ACTIVE' })).toContain('STATE_DECOMMISSIONED_IN_USE');
    expect(hit({ componentLifecycle: 'IN_TEST', deploymentStatus: 'DEPLOYED_PRODUCTION' })).toContain('STATE_COMPONENT_UNRELEASED_IN_PRODUCTION');
    expect(hit({ componentLifecycle: 'RETIRED', deploymentStatus: 'DEPLOYED_NON_PRODUCTION' })).toContain('STATE_COMPONENT_RETIRED_IN_USE');
    expect(hit({ componentLifecycle: 'PLANNED', operationalStatus: 'ACTIVE' })).toContain('STATE_COMPONENT_UNRELEASED_ACTIVE');
    expect(CONSISTENCY_RULE_CODES).toHaveLength(8);
  });
});

describe('model card v2: owners must be people (D8)', () => {
  const u = (over: Partial<OwnerCandidate> = {}): OwnerCandidate => ({
    id: 'u1', fullName: 'Admin Dhancept', email: 'admin.dhancept@example.test', isActive: true, tenantId: 'org-1', role: 'CISO', ...over,
  });

  it('refuses a service account, an inactive user, another org and a missing user', () => {
    expect(checkOwner(u({ accountType: 'SERVICE' }), 'org-1')).toMatchObject({ ok: false, code: 'OWNER_SERVICE_ACCOUNT' });
    expect(checkOwner(u({ isActive: false }), 'org-1')).toMatchObject({ ok: false, code: 'OWNER_INACTIVE' });
    expect(checkOwner(u(), 'org-2')).toMatchObject({ ok: false, code: 'OWNER_OTHER_ORG' });
    expect(checkOwner(null, 'org-1')).toMatchObject({ ok: false, code: 'OWNER_NOT_FOUND' });
  });

  it('accepts a named person, including rows written before accountType existed', () => {
    expect(checkOwner(u({ accountType: 'HUMAN' }), 'org-1')).toEqual({ ok: true });
    expect(checkOwner(u({ accountType: undefined }), 'org-1')).toEqual({ ok: true });
  });
});
