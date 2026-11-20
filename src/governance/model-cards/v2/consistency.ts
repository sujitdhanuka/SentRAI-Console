/**
 * Model card v2: the state consistency validator (spec §4, defect D2).
 *
 * A record carries four separate state fields. Some combinations cannot be
 * true at the same time (a model still in DESIGN cannot be operationally
 * ACTIVE; something not deployed cannot be serving). Every finding blocks
 * FINAL. A state that has not been assessed (null) is never used to raise or
 * clear a finding: the check runs only on pairs where both values are known.
 */
import { ComponentLifecycle, DeploymentStatus, ModelLifecycle, OperationalStatus } from './record-types';

export interface RecordStates {
  componentLifecycle: ComponentLifecycle | null;
  modelLifecycle: ModelLifecycle | null;
  deploymentStatus: DeploymentStatus | null;
  operationalStatus: OperationalStatus | null;
}

export interface ConsistencyFinding {
  code: string;
  /** Catalogue field ids involved, so the UI can point at them. */
  fields: Array<keyof RecordStates>;
  message: string;
}

const PRE_DEPLOYMENT: readonly ModelLifecycle[] = ['DESIGN', 'DEVELOPMENT', 'VALIDATION'];
const LIVE_LIFECYCLE: readonly ModelLifecycle[] = ['DEPLOYED', 'MONITORING'];
const DEPLOYED: readonly DeploymentStatus[] = ['DEPLOYED_NON_PRODUCTION', 'DEPLOYED_PRODUCTION'];
const PRE_RELEASE: readonly ComponentLifecycle[] = ['PLANNED', 'IN_DEVELOPMENT', 'IN_TEST'];

interface Rule {
  code: string;
  fields: Array<keyof RecordStates>;
  when: (s: RecordStates) => boolean;
  message: (s: RecordStates) => string;
}

const known = (...v: unknown[]) => v.every((x) => x !== null && x !== undefined);

const RULES: Rule[] = [
  {
    code: 'STATE_PRE_DEPLOYMENT_ACTIVE',
    fields: ['modelLifecycle', 'operationalStatus'],
    when: (s) => known(s.modelLifecycle, s.operationalStatus) && PRE_DEPLOYMENT.includes(s.modelLifecycle!) && s.operationalStatus === 'ACTIVE',
    message: (s) => `Model lifecycle is ${s.modelLifecycle} but operational status is ACTIVE. A record that has not been deployed cannot be operating.`,
  },
  {
    code: 'STATE_NOT_DEPLOYED_ACTIVE',
    fields: ['deploymentStatus', 'operationalStatus'],
    when: (s) => known(s.deploymentStatus, s.operationalStatus) && s.deploymentStatus === 'NOT_DEPLOYED' && s.operationalStatus === 'ACTIVE',
    message: () => 'Deployment status is NOT_DEPLOYED but operational status is ACTIVE.',
  },
  {
    code: 'STATE_LIVE_NOT_DEPLOYED',
    fields: ['modelLifecycle', 'deploymentStatus'],
    when: (s) => known(s.modelLifecycle, s.deploymentStatus) && LIVE_LIFECYCLE.includes(s.modelLifecycle!) && s.deploymentStatus === 'NOT_DEPLOYED',
    message: (s) => `Model lifecycle is ${s.modelLifecycle} but deployment status is NOT_DEPLOYED.`,
  },
  {
    code: 'STATE_PRODUCTION_BEFORE_VALIDATION',
    fields: ['modelLifecycle', 'deploymentStatus'],
    when: (s) => known(s.modelLifecycle, s.deploymentStatus) && (s.modelLifecycle === 'DESIGN' || s.modelLifecycle === 'DEVELOPMENT') && s.deploymentStatus === 'DEPLOYED_PRODUCTION',
    message: (s) => `Deployed to production while the model lifecycle is still ${s.modelLifecycle}.`,
  },
  {
    code: 'STATE_DECOMMISSIONED_IN_USE',
    fields: ['modelLifecycle', 'deploymentStatus', 'operationalStatus'],
    when: (s) => s.modelLifecycle === 'DECOMMISSIONED' && ((s.deploymentStatus !== null && DEPLOYED.includes(s.deploymentStatus)) || s.operationalStatus === 'ACTIVE'),
    message: () => 'The model is DECOMMISSIONED but is still deployed or operating.',
  },
  {
    code: 'STATE_COMPONENT_UNRELEASED_IN_PRODUCTION',
    fields: ['componentLifecycle', 'deploymentStatus'],
    when: (s) => known(s.componentLifecycle, s.deploymentStatus) && PRE_RELEASE.includes(s.componentLifecycle!) && s.deploymentStatus === 'DEPLOYED_PRODUCTION',
    message: (s) => `The component is ${s.componentLifecycle} but is deployed to production.`,
  },
  {
    code: 'STATE_COMPONENT_UNRELEASED_ACTIVE',
    fields: ['componentLifecycle', 'operationalStatus'],
    when: (s) => known(s.componentLifecycle, s.operationalStatus) && PRE_RELEASE.includes(s.componentLifecycle!) && s.operationalStatus === 'ACTIVE',
    message: (s) => `The component is ${s.componentLifecycle} but operational status is ACTIVE. An unreleased component cannot be operating.`,
  },
  {
    code: 'STATE_COMPONENT_RETIRED_IN_USE',
    fields: ['componentLifecycle', 'deploymentStatus', 'operationalStatus'],
    when: (s) => s.componentLifecycle === 'RETIRED' && ((s.deploymentStatus !== null && DEPLOYED.includes(s.deploymentStatus)) || s.operationalStatus === 'ACTIVE'),
    message: () => 'The component is RETIRED but is still deployed or operating.',
  },
];

/** Every contradiction among the four state fields. An empty list means none found. */
export function checkConsistency(s: RecordStates): ConsistencyFinding[] {
  return RULES.filter((r) => r.when(s)).map((r) => ({ code: r.code, fields: r.fields, message: r.message(s) }));
}

export const CONSISTENCY_RULE_CODES = RULES.map((r) => r.code);
