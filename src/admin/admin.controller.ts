import { Controller, ForbiddenException, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';
import { DemoSeedService, DemoSeedResult } from './demo-seed.service';

@ApiTags('admin')
@Controller('api/v1/admin')
export class AdminController {
  constructor(
    private readonly demoSeed: DemoSeedService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Provision (or top up) the "Meridian Finance" demo tenant + read-only judge
   * account on this instance. ADMIN-only, and it drives the app's own API on
   * localhost using the caller's own token — so an operator can enable the
   * evaluation login from their logged-in session with one request, no shell,
   * no password, no redeploy. Idempotent.
   */
  @Post('seed-demo')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Provision the read-only demo/evaluation tenant (ADMIN only, idempotent)' })
  async seedDemo(@Req() req: any): Promise<DemoSeedResult> {
    const header = String(req.headers?.authorization ?? '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new ForbiddenException('Missing bearer token.');
    return this.demoSeed.seed(token, this.baseUrl(req));
  }

  /**
   * The origin to drive the seed through. The seeder calls the app's own REST
   * API, so it must reach a live listener — and under Passenger/proxy hosting
   * (e.g. Hostinger) there is no reachable 127.0.0.1:$PORT, only the public
   * origin. Prefer an explicit override, then the request's own forwarded
   * origin (what the admin's browser reached us on — the proxy round-trips it
   * straight back in), then localhost for a plain `node dist/main` dev run.
   */
  private baseUrl(req: any): string {
    const override = process.env.DEMO_SEED_BASE_URL?.trim() || process.env.PUBLIC_URL?.trim();
    if (override) return override.replace(/\/$/, '');
    const proto = String(req.headers?.['x-forwarded-proto'] ?? req.protocol ?? 'http').split(',')[0].trim();
    const host = String(req.headers?.['x-forwarded-host'] ?? req.headers?.host ?? '').split(',')[0].trim();
    if (host) return `${proto}://${host}`;
    const port = this.config.get<number>('port') ?? Number(process.env.PORT ?? 8000);
    return `http://127.0.0.1:${port}`;
  }
}
