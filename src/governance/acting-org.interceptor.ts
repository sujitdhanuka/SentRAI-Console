/**
 * Lets a global (organization-less) OWNER or ADMIN work in one organization's
 * governance: the console sends the organization of the selected project scope
 * in the X-SentrAI-Org header, and for the rest of the request the caller acts
 * as if they belonged to it. Every governance service already keys off
 * user.tenantId, so this one seam covers them all.
 *
 * Members of an organization always act in their own organization; the header
 * is ignored for them, so it can never widen what an org-scoped user sees.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable } from 'rxjs';
import { Repository } from 'typeorm';

import { Role } from '../common/enums';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { OrganizationEntity } from '../database/entities';

export const ACTING_ORG_HEADER = 'x-sentrai-org';

const GLOBAL_ROLES: string[] = [Role.ADMIN, Role.OWNER];

@Injectable()
export class ActingOrgInterceptor implements NestInterceptor {
  constructor(@InjectRepository(OrganizationEntity) private readonly orgs: Repository<OrganizationEntity>) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, unknown>; user?: CurrentUser }>();
    const requested = req.headers?.[ACTING_ORG_HEADER];
    const user = req.user;
    if (typeof requested === 'string' && requested && user && user.tenantId === null && GLOBAL_ROLES.includes(user.role)) {
      const org = await this.orgs.findOne({ where: { id: requested } });
      if (!org) throw new NotFoundException('Organization not found');
      req.user = { ...user, tenantId: org.id };
    }
    return next.handle();
  }
}
