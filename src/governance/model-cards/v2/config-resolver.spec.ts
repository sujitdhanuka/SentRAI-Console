import { decideDefaultSwitch, LinkedModel, resolveConfiguration } from './config-resolver';

const m = (id: string, tier: LinkedModel['inherentTier'], cardApproved = true): LinkedModel => ({ id, name: id.toUpperCase(), provider: 'p', inherentTier: tier, cardApproved });

describe('model card v2: model configurations (spec §4)', () => {
  it('resolves the effective model per tenant: global default, override and BYOK', () => {
    const r = resolveConfiguration({
      defaultModelId: 'gpt', selectable: [m('gpt', 'MEDIUM'), m('claude', 'MEDIUM')], tenantReach: 'ALL_TENANTS',
      overrides: [
        { tenant: 'Acme', byok: true, model_record_id: 'claude', inherits_default: false },
        { tenant: 'Beta', byok: false, inherits_default: true },
      ],
    });
    expect(r.effective.map((e) => [e.tenant, e.model_id, e.source, e.key_responsibility])).toEqual([
      ['(all tenants without an override)', 'gpt', 'GLOBAL_DEFAULT', 'PLATFORM'],
      ['Acme', 'claude', 'BYOK', 'TENANT'],
      ['Beta', 'gpt', 'GLOBAL_DEFAULT', 'PLATFORM'],
    ]);
    expect(r.findings).toEqual([]);
  });

  it('sets the inherent floor at the highest selectable model, raised one tier when every tenant is reached', () => {
    const all = resolveConfiguration({ defaultModelId: 'a', selectable: [m('a', 'LOW'), m('b', 'MEDIUM')], tenantReach: 'ALL_TENANTS', overrides: [] });
    expect(all.inherent_floor).toBe('HIGH');
    const some = resolveConfiguration({ defaultModelId: 'a', selectable: [m('a', 'LOW'), m('b', 'MEDIUM')], tenantReach: 'SOME_TENANTS', overrides: [] });
    expect(some.inherent_floor).toBe('MEDIUM');
    // Reach not recorded: assume the worst case.
    expect(resolveConfiguration({ defaultModelId: 'a', selectable: [m('a', 'LOW')], tenantReach: null, overrides: [] }).inherent_floor).toBe('MEDIUM');
    expect(resolveConfiguration({ defaultModelId: 'a', selectable: [m('a', 'CRITICAL')], tenantReach: 'ALL_TENANTS', overrides: [] }).inherent_floor).toBe('CRITICAL');
  });

  it('leaves the floor unknown while a selectable model is not assessed, and flags unlinked models', () => {
    const r = resolveConfiguration({ defaultModelId: 'x', selectable: [m('a', null)], tenantReach: 'ALL_TENANTS', overrides: [{ tenant: 'T', byok: true, model_record_id: 'zzz', inherits_default: false }] });
    expect(r.inherent_floor).toBeNull();
    expect(r.findings.map((f) => f.code)).toEqual(['CONFIG_DEFAULT_NOT_LINKED', 'CONFIG_OVERRIDE_NOT_LINKED', 'CONFIG_MODEL_NOT_ASSESSED']);
    expect(resolveConfiguration({ defaultModelId: null, selectable: [], tenantReach: null, overrides: [] }).findings.map((f) => f.code)).toEqual(['CONFIG_NO_DEFAULT', 'CONFIG_NO_MODELS']);
  });

  it('blocks a switch to a model without an approved card unless a named person accepts the risk; every switch needs reassessment', () => {
    expect(decideDefaultSwitch(m('ok', 'LOW', true))).toMatchObject({ allowed: true, reassessment_required: true });
    expect(decideDefaultSwitch(m('new', 'LOW', false))).toMatchObject({ allowed: false });
    expect(decideDefaultSwitch(m('new', 'LOW', false), { by: 'risk.owner@example.test', reason: 'short' })).toMatchObject({ allowed: false });
    expect(decideDefaultSwitch(m('new', 'LOW', false), { by: 'risk.owner@example.test', reason: 'Provider outage; 14-day exception agreed by the risk committee.' }))
      .toMatchObject({ allowed: true, risk_acceptance_used: true });
    expect(decideDefaultSwitch(null)).toMatchObject({ allowed: false });
  });
});
