/**
 * The common control library (E1.1). MODEL controls are here now; ORG
 * controls (ISO clauses 4–10 read from the AIMS workspace) join in E1.6.
 */
import { ControlDefinition } from './control.types';
import { MODEL_CONTROLS } from './model-controls';
import { ORG_CONTROLS } from './org-controls';
import { PHASE2_CONTROLS } from './phase2-controls';

const LIBRARY = new Map<string, ControlDefinition>();
for (const c of [...MODEL_CONTROLS, ...ORG_CONTROLS, ...PHASE2_CONTROLS]) LIBRARY.set(c.id, c);

export function getControl(id: string): ControlDefinition | undefined {
  return LIBRARY.get(id);
}

export function listControls(): ControlDefinition[] {
  return [...LIBRARY.values()];
}

/** Later epics register their controls (ORG controls, register-backed checks) at import time. */
export function registerControl(def: ControlDefinition): void {
  LIBRARY.set(def.id, def);
}
