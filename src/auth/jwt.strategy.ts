import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { CurrentUser } from '../common/interfaces/current-user.interface';
import { Role } from '../common/enums';

interface JwtClaims {
  sub: string;
  role?: string;
  tenant_id?: string | null;
  name?: string;
  type?: string;
  exp?: number;
}

/**
 * Validates the HS256 access token and rebuilds the request principal from its
 * claims — no per-request DB hit, matching Python's get_current_user().
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<{ secret: string }>('jwt')!.secret,
    });
  }

  validate(payload: JwtClaims): CurrentUser {
    return {
      userId: payload.sub,
      email: payload.sub,
      fullName: payload.name ?? '',
      role: (payload.role as Role) ?? Role.VIEWER,
      tenantId: payload.tenant_id ?? null,
    };
  }
}
