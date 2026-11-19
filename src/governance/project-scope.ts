/**
 * Project scope for the governance console. When a project is selected in the
 * console, every request carries it in the X-SentrAI-Project header; the
 * ActingOrgInterceptor checks it belongs to the organisation the caller acts
 * in and runs the request inside this scope. Model-level lists and overviews
 * then show only that project's models and their records, while records that
 * belong to the organisation rather than to one model (organisation risks,
 * policies, documents, training) stay visible.
 *
 * The scope only ever narrows what a request returns: it is ignored unless
 * the project is in the caller's organisation, and organisation-wide
 * documents (Statement of Applicability, public disclosures) are built from
 * the whole organisation regardless.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { FindOptionsWhere, In, IsNull, Not, Repository } from 'typeorm';

import { AIModelEntity } from '../database/entities';

export const PROJECT_SCOPE_HEADER = 'x-sentrai-project';

const store = new AsyncLocalStorage<{ projectId: string }>();

/** Runs fn inside the project scope (or unscoped when projectId is null). */
export function runInProjectScope<T>(projectId: string | null, fn: () => T): T {
  return projectId ? store.run({ projectId }, fn) : fn();
}

/** The project this request is scoped to, or null for the whole organisation. */
export function scopedProjectId(): string | null {
  return store.getStore()?.projectId ?? null;
}

/** Placeholder id that matches nothing, so an empty project yields no rows (In([]) is not portable). */
const NONE = '00000000-0000-0000-0000-000000000000';

/** Ids of the scoped project's models, or null when the request is not scoped. */
export async function scopedModelIds(models: Repository<AIModelEntity>): Promise<string[] | null> {
  const projectId = scopedProjectId();
  if (!projectId) return null;
  return (await models.find({ where: { projectId }, select: ['id'] })).map((m) => m.id);
}

/**
 * Narrows a find() where-clause on `field` (a model id column) to the scoped
 * project's models. With keepUnlinked, rows with no model (organisation-level
 * records) stay too. A where that already names one model is left as it is:
 * the caller asked for that model (a model page), and the organisation check
 * has already been applied.
 */
export async function scopeModelWhere<T extends Record<string, any>>(
  models: Repository<AIModelEntity>,
  where: T,
  field = 'modelId',
  keepUnlinked = false,
): Promise<T | T[]> {
  const ids = await scopedModelIds(models);
  if (!ids) return where;
  if (typeof where[field] === 'string') return where;
  const scoped = { ...where, [field]: In(ids.length ? ids : [NONE]) };
  return keepUnlinked ? [scoped, { ...where, [field]: IsNull() }] : scoped;
}

/**
 * Risk-register variant: MODEL risks are narrowed to the project's models;
 * organisation, use-case and vendor risks stay.
 */
export async function scopeRiskWhere(models: Repository<AIModelEntity>, where: Record<string, any>): Promise<FindOptionsWhere<any> | FindOptionsWhere<any>[]> {
  const ids = await scopedModelIds(models);
  if (!ids) return where;
  const modelIds = In(ids.length ? ids : [NONE]);
  if (where.scopeType === 'MODEL') {
    if (typeof where.scopeId === 'string') return where;
    return { ...where, scopeId: modelIds };
  }
  if (where.scopeType) return where;
  return [{ ...where, scopeType: 'MODEL', scopeId: modelIds }, { ...where, scopeType: Not('MODEL') }];
}
