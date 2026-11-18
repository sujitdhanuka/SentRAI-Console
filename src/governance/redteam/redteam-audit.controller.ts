import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { ActingOrgInterceptor } from '../acting-org.interceptor';
import { MAINTAINERS } from '../phase2-util';
import { RedTeamAuditService } from './redteam-audit.service';

/** Red-team and audit rules (E2.8). 404 unless GOV_E2_8_REDTEAM_AUDIT is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class RedTeamAuditController {
  constructor(private readonly r: RedTeamAuditService) {}

  @Get('assurance')
  overview(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.r.overview(user, q);
  }

  @Get('models/:modelId/assurance')
  model(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.r.modelStatus(user, modelId);
  }

  @Post('models/:modelId/red-team')
  @HttpCode(HttpStatus.OK)
  @Roles(...MAINTAINERS)
  record(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.r.recordRedTeam(user, modelId, body, req);
  }
}
