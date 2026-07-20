import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** Claims carried by a CI service token. */
export interface CiTokenClaims {
  sub: string; // ci:<projectId>
  type: 'ci';
  project_id: string;
  label?: string;
}

/**
 * Mints and verifies long-lived, project-scoped CI service tokens. They are
 * signed with the same HS256 secret as interactive tokens but carry
 * `type: 'ci'`, so the CI guard can distinguish an automated pipeline account
 * from an interactive user and refuse the wrong token on either surface.
 */
@Injectable()
export class CiTokenService {
  constructor(private readonly jwt: JwtService) {}

  mint(projectId: string, label?: string): string {
    const payload: CiTokenClaims = {
      sub: `ci:${projectId}`,
      type: 'ci',
      project_id: projectId,
      ...(label ? { label } : {}),
    };
    // Long-lived: CI tokens are stored as pipeline secrets and rotated by the org.
    return this.jwt.sign(payload, { expiresIn: '365d' });
  }

  verify(token: string): CiTokenClaims {
    const claims = this.jwt.verify<CiTokenClaims>(token);
    if (claims.type !== 'ci' || !claims.project_id) {
      throw new Error('Not a CI service token');
    }
    return claims;
  }
}
