/**
 * Shared access rules for the governance module: every route answers 404
 * while its flag is off (hosted behaviour unchanged), and a model or record
 * in another organisation is a 404 so its existence is not disclosed. ADMIN
 * is the platform superuser and sees every organisation.
 */
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { Role } from '../common/enums';
import { EpicFlag, FeatureFlagsService } from '../common/feature-flags';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { AIModelEntity, ProjectEntity } from '../database/entities';

export function assertFlag(flags: FeatureFlagsService, flag: EpicFlag): void {
  if (!flags.isEnabled(flag)) throw new NotFoundException();
}

export async function modelForUser(
  models: Repository<AIModelEntity>,
  projects: Repository<ProjectEntity>,
  user: CurrentUser,
  modelId: string,
): Promise<{ model: AIModelEntity; orgId: string | null }> {
  const model = await models.findOne({ where: { id: modelId } });
  if (!model) throw new NotFoundException('Model not found');
  const project = model.projectId ? await projects.findOne({ where: { id: model.projectId } }) : null;
  const orgId = project?.tenantId ?? null;
  if (user.role !== Role.ADMIN && orgId !== (user.tenantId ?? null)) throw new NotFoundException('Model not found');
  return { model, orgId };
}

/** The organisation a request acts on: the caller's own, or (ADMIN only) the one named. */
export function orgScope(user: CurrentUser, requested?: string | null): string {
  if (user.role === Role.ADMIN && requested) return requested;
  if (!user.tenantId) {
    if (user.role === Role.ADMIN) throw new NotFoundException('Name an organization with ?org_id= (platform admin)');
    throw new NotFoundException('No organization');
  }
  return user.tenantId;
}
