/**
 * Which parameters actually change a result today. A parameter is enforced
 * when a library control reads it, or when one of the named platform features
 * below does. Anything else is recorded (it resolves strictest-wins and shows
 * which pack set it) but is reported as "not yet enforced", so the parameters
 * view and the settings window never imply a check that does not run.
 */
import { listControls } from '../controls/control-library';
import { PARAMETER_SPECS } from './parameter-resolver';

/** Consumers outside the control library, by parameter. */
export const PARAMETER_CONSUMERS: Record<string, string[]> = {
  euHighRiskDomains: ['EU AI Act risk-tier classifier'],
};

export function parameterEnforcement(name: string): { enforced: boolean; enforcedBy: string[] } {
  const controls = listControls().filter((c) => c.parameters.includes(name)).map((c) => c.id);
  const enforcedBy = [...controls, ...(PARAMETER_CONSUMERS[name] ?? [])];
  return { enforced: enforcedBy.length > 0, enforcedBy };
}

/** Every known parameter with its enforcement status (for the settings window). */
export function parameterCatalog() {
  return PARAMETER_SPECS.map((s) => ({ name: s.name, rule: s.rule, unit: s.unit ?? null, description: s.description, ...parameterEnforcement(s.name) }));
}
