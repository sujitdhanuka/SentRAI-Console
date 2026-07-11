import { Role } from '../enums';

/**
 * The authenticated principal attached to each request by JwtStrategy.
 * Mirrors the Python `User` object built by get_current_user() from the JWT
 * claims (user_id == email in the token context).
 */
export interface CurrentUser {
  userId: string;
  email: string;
  fullName: string;
  role: Role;
  tenantId: string | null;
}
