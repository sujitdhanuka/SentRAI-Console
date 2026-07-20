import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { Role } from '../common/enums';
import { CiEvaluationService } from './ci.service';
import { CiTokenService } from './ci-token.service';
import { CiServiceTokenGuard } from './ci-token.guard';
import { CiScanDto, CiTokenDto } from './ci.dto';

@ApiTags('CI / Pre-Deployment Gate')
@Controller('api/v1/ci')
export class CiController {
  constructor(
    private readonly ci: CiEvaluationService,
    private readonly tokens: CiTokenService,
  ) {}

  /**
   * Stateless pre-deployment scan. Authenticated by a CI service token (not an
   * interactive session), so it bypasses the global JWT guard and is bound to
   * its project by CiServiceTokenGuard. Returns a machine-readable verdict +
   * SARIF; the pipeline exits non-zero on `fail`.
   */
  @Public()
  @UseGuards(CiServiceTokenGuard)
  @Post('scan')
  @HttpCode(HttpStatus.OK)
  scan(@Body() dto: CiScanDto, @Req() req: any) {
    const { projectId, actor } = req.ciContext;
    return this.ci.runScanAndEvaluate(projectId, actor, dto);
  }

  /** Admin mints a long-lived CI service token to store as a pipeline secret. */
  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.CISO)
  @Post('tokens')
  @HttpCode(HttpStatus.CREATED)
  mintToken(@CurrentUser() _admin: CurrentUserType, @Body() dto: CiTokenDto) {
    const token = this.tokens.mint(dto.project_id, dto.label);
    return {
      project_id: dto.project_id,
      token,
      usage: 'Store as the SENTRAI_CI_TOKEN secret in your pipeline. Valid 365 days; rotate by minting a new one.',
    };
  }

  /** Auditor view of the immutable pre-deployment gate trail for a project. */
  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.CISO, Role.REVIEWER)
  @Get('projects/:projectId/gate-history')
  history(@Param('projectId') projectId: string, @Query('limit') limit?: string) {
    return this.ci.history(projectId, limit ? parseInt(limit, 10) : 50);
  }
}
