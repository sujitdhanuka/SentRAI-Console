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
    const port = this.config.get<number>('port') ?? Number(process.env.PORT ?? 8000);
    return this.demoSeed.seed(token, `http://127.0.0.1:${port}`);
  }
}
