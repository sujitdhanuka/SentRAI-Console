import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { RISK_WRITERS } from '../risks/risks.service';
import { IA_SIGNERS, ImpactAssessmentService } from './impact.service';
import { ActingOrgInterceptor } from '../acting-org.interceptor';

/** Impact assessments (E1.4). 404 unless GOV_E1_4_IMPACT is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance/impact-assessments')
export class ImpactAssessmentController {
  constructor(private readonly ia: ImpactAssessmentService) {}

  @Get('templates')
  templates() {
    return this.ia.templates();
  }

  @Get()
  list(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.ia.list(user, q);
  }

  @Get(':id')
  get(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.ia.get(user, id);
  }

  @Get(':id/report')
  report(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Query('layout') layout?: string, @Query('format') format?: string) {
    return this.ia.report(user, id, layout ?? 'iso', format ?? 'json');
  }

  @Post()
  @Roles(...RISK_WRITERS)
  create(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>) {
    return this.ia.create(user, body);
  }

  @Patch(':id')
  @Roles(...RISK_WRITERS)
  update(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>) {
    return this.ia.update(user, id, body);
  }

  @Post(':id/finalise')
  @HttpCode(HttpStatus.OK)
  @Roles(...IA_SIGNERS)
  finalise(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Req() req: any) {
    return this.ia.finalise(user, id, req);
  }

  @Post(':id/new-version')
  @Roles(...RISK_WRITERS)
  newVersion(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.ia.newVersion(user, id);
  }
}
