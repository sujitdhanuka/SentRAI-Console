import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { PacksService } from './packs.service';
import { ActingOrgInterceptor } from '../acting-org.interceptor';

/** Framework packs and the control library (E1.1). Every route is a 404 unless GOV_E1_1_PACKS is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance')
export class PacksController {
  constructor(private readonly packs: PacksService) {}

  @Get('packs')
  list() {
    return this.packs.listPacks();
  }

  @Get('packs/:id/versions')
  versions(@Param('id') id: string) {
    return this.packs.packVersions(id);
  }

  @Get('packs/:id/diff')
  diff(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.packs.packDiff(id, from, to);
  }

  @Get('controls')
  controls() {
    return this.packs.controlLibrary();
  }

  @Get('parameters')
  parameters(@CurrentUser() user: CurrentUserType, @Query('as_of') asOf?: string) {
    return this.packs.parameters(user.tenantId ?? null, asOf);
  }

  /** Live evaluation of every pack in force (or as of a past date) for one model. */
  @Get('models/:modelId/controls')
  evaluate(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Query('as_of') asOf?: string) {
    return this.packs.evaluateModel(user, modelId, asOf);
  }

  /** Latest recorded control results for a model. */
  @Get('models/:modelId/control-results')
  results(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.packs.latestResults(user, modelId);
  }

  /** Evaluate now and record the control results (one row per control). */
  @Post('models/:modelId/evaluate')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.OWNER, Role.CISO, Role.ADMIN, Role.REVIEWER, Role.APPROVER)
  record(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string) {
    return this.packs.recordEvaluation(user, modelId);
  }
}
