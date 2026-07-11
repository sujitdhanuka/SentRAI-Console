import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums';

/**
 * Restricts a route to one of the given roles. Mirrors Python's require_role(*roles).
 * Enforced by RolesGuard.
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
