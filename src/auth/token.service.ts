import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/**
 * Issues and decodes JWTs. Claim shape and lifetimes match Python's
 * api/middleware/auth.py (access: 8h, refresh: 30d, HS256).
 */
@Injectable()
export class TokenService {
  private readonly accessMinutes: number;
  private readonly refreshDays: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    const cfg = config.get<{ accessTokenExpireMinutes: number; refreshTokenExpireDays: number }>(
      'jwt',
    )!;
    this.accessMinutes = cfg.accessTokenExpireMinutes;
    this.refreshDays = cfg.refreshTokenExpireDays;
  }

  createAccessToken(subject: string, role: string, tenantId: string | null, name = ''): string {
    return this.jwt.sign(
      { sub: subject, role, tenant_id: tenantId, name, type: 'access' },
      { expiresIn: `${this.accessMinutes}m` },
    );
  }

  createRefreshToken(subject: string): string {
    return this.jwt.sign({ sub: subject, type: 'refresh' }, { expiresIn: `${this.refreshDays}d` });
  }

  decode(token: string): Record<string, any> {
    // Throws JsonWebTokenError / TokenExpiredError on invalid tokens.
    return this.jwt.verify(token);
  }
}
