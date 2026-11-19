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
import { CiScanDto, CiTokenDto, CiOverrideDto } from './ci.dto';

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

  /** Admin/CISO mints a long-lived CI service token to store as a pipeline secret. */
  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.CISO)
  @Post('tokens')
  @HttpCode(HttpStatus.CREATED)
  async mintToken(@CurrentUser() user: CurrentUserType, @Body() dto: CiTokenDto) {
    // Validate the project exists AND belongs to the caller's org BEFORE minting,
    // so a bad/foreign project_id fails clearly here instead of producing a token
    // that mysteriously 401s ("project no longer exists") at scan time.
    await this.ci.assertProjectForToken(user, dto.project_id);
    const token = this.tokens.mint(dto.project_id, dto.label);
    return {
      project_id: dto.project_id,
      token,
      usage: 'Store as the SENTRAI_CI_TOKEN secret in your pipeline. Valid 365 days; rotate by minting a new one.',
    };
  }

  /**
   * Org-wide gate ledger for the auditor dashboard. Tenant-scoped in the
   * service (non-admins see only their organization's events). Optional
   * `?verdict=fail` and `?limit=` filters.
   */
  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.OWNER, Role.CISO, Role.REVIEWER, Role.APPROVER)
  @Get('events')
  events(
    @CurrentUser() user: CurrentUserType,
    @Query('limit') limit?: string,
    @Query('verdict') verdict?: string,
    @Query('project_id') projectId?: string,
  ) {
    return this.ci.listEvents(user, {
      projectId,
      limit: limit ? parseInt(limit, 10) : undefined,
      verdict: verdict === 'pass' || verdict === 'fail' ? verdict : undefined,
    });
  }

  /** The SARIF artifact for a recorded gate event, rebuilt from the ledger. */
  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.OWNER, Role.CISO, Role.REVIEWER, Role.APPROVER)
  @Get('events/:id/sarif')
  eventSarif(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.ci.eventSarif(user, id);
  }

  /**
   * Auditor sign-off override of a failed gate. Additive by design: the
   * original `verdict='fail'` is preserved on the record; this attaches the
   * auditor's identity, timestamp, and mandatory justification. Requires a
   * sign-off role (ADMIN / CISO / APPROVER) and org ownership of the project.
   */
  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.CISO, Role.APPROVER)
  @Post('events/:id/override')
  @HttpCode(HttpStatus.OK)
  override(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Body() dto: CiOverrideDto,
  ) {
    return this.ci.overrideEvent(user, id, dto.reason);
  }

  /** Auditor view of the immutable pre-deployment gate trail for a project. */
  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.OWNER, Role.CISO, Role.REVIEWER, Role.APPROVER)
  @Get('projects/:projectId/gate-history')
  history(
    @CurrentUser() user: CurrentUserType,
    @Param('projectId') projectId: string,
    @Query('limit') limit?: string,
  ) {
    return this.ci.history(user, projectId, limit ? parseInt(limit, 10) : 50);
  }
}
