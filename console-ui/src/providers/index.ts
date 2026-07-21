import { GovernanceProvider, MockGovernanceProvider } from './governance';
import { HttpGovernanceProvider } from './http-governance';

export * from './governance';
export { SUTRA_ENUM } from './http-governance';

/** Demo mode (?demo=1) keeps the seeded mock; otherwise the dashboard talks to
 *  the live SentRAI Console API on the same origin. */
export const isDemoMode = new URLSearchParams(window.location.search).has('demo');

export const provider: GovernanceProvider = isDemoMode
  ? new MockGovernanceProvider()
  : new HttpGovernanceProvider();
