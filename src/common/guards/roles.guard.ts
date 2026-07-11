import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums';
import { CurrentUser } from '../interfaces/current-user.interface';

/**
 * Enforces @Roles(...) metadata. Runs after JwtAuthGuard, so request.user is
 * already populated. Mirrors Python's require_role dependency.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user: CurrentUser | undefined = context.switchToHttp().getRequest().user;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException(
        `Role '${user?.role}' is not permitted. Required: ${required.join(', ')}`,
      );
    }
    return true;
  }
}
