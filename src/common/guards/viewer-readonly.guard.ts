import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { VIEWER_WRITABLE_KEY } from '../decorators/viewer-writable.decorator';
import { Role } from '../enums';
import { CurrentUser } from '../interfaces/current-user.interface';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Makes the VIEWER role read-only across the entire API. Per-controller @Roles
 * allowlists cover the sensitive surfaces, but the core resource controllers
 * (projects, inventory, monitoring, compliance…) only require authentication —
 * so without this a VIEWER (the tier every public self-registration collapses
 * to) could mutate them. This closes that gap in one place, and keeps the
 * read-only "judge"/evaluation account safe on a shared live demo tenant.
 *
 * Runs after JwtAuthGuard so request.user is populated. Only blocks mutating
 * methods for an authenticated VIEWER; @Public routes and any handler marked
 * @ViewerWritable() are exempt.
 */
@Injectable()
export class ViewerReadOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest();
    if (SAFE_METHODS.has(String(req.method).toUpperCase())) return true;

    const user: CurrentUser | undefined = req.user;
    if (!user || user.role !== Role.VIEWER) return true;

    if (this.reflector.getAllAndOverride<boolean>(VIEWER_WRITABLE_KEY, targets)) return true;

    throw new ForbiddenException('Read-only account: the VIEWER role cannot modify data.');
  }
}
