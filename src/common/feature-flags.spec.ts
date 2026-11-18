import { FeatureFlagsService, getFeatureFlags } from './feature-flags';

describe('feature flags', () => {
  it('everything is off with no environment variables', () => {
    expect(getFeatureFlags({})).toEqual({ governanceV2: false, redTeamIntervals: false, bcpDrills: false, nistPrivacy: false });
  });

  it('epic flags cannot turn on without the master switch', () => {
    const f = getFeatureFlags({ GOV_E0_4_BCP_DRILLS: 'true', GOV_E0_5_NIST_PRIVACY: '1' });
    expect(f.bcpDrills).toBe(false);
    expect(f.nistPrivacy).toBe(false);
  });

  it('the master switch enables every epic, and each can be turned off', () => {
    expect(getFeatureFlags({ GOVERNANCE_V2: 'true' })).toEqual({
      governanceV2: true, redTeamIntervals: true, bcpDrills: true, nistPrivacy: true,
    });
    const f = getFeatureFlags({ GOVERNANCE_V2: 'on', GOV_E0_4_BCP_DRILLS: 'false' });
    expect(f.bcpDrills).toBe(false);
    expect(f.redTeamIntervals).toBe(true);
  });

  it('the service reads the live environment', () => {
    const svc = new FeatureFlagsService();
    const prev = process.env.GOVERNANCE_V2;
    process.env.GOVERNANCE_V2 = 'true';
    expect(svc.isEnabled('nistPrivacy')).toBe(true);
    if (prev === undefined) delete process.env.GOVERNANCE_V2;
    else process.env.GOVERNANCE_V2 = prev;
    expect(svc.isEnabled('governanceV2')).toBe(prev === 'true');
  });
});
