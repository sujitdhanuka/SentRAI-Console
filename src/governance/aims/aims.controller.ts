import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { AIMS_EDITORS, AimsService } from './aims.service';
import { ActingOrgInterceptor } from '../acting-org.interceptor';

/** AIMS workspace (E1.6). 404 unless GOV_E1_6_AIMS is on. Edit: Owner, CISO, Admin of the org. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1/governance/aims')
export class AimsController {
  constructor(private readonly aims: AimsService) {}

  @Get('types')
  types() {
    return this.aims.types();
  }

  @Get('summary')
  summary(@CurrentUser() user: CurrentUserType, @Query('org_id') orgId?: string) {
    return this.aims.summary(user, orgId);
  }

  /** ORG-scope control results for every pack in force (ISO clauses 4–10, RBI Rec 14). */
  @Get('controls')
  controls(@CurrentUser() user: CurrentUserType, @Query('org_id') orgId?: string) {
    return this.aims.orgControls(user, orgId);
  }

  @Post('controls/evaluate')
  @HttpCode(HttpStatus.OK)
  @Roles(...AIMS_EDITORS)
  record(@CurrentUser() user: CurrentUserType) {
    return this.aims.recordOrgControls(user);
  }

  @Get('mgmt-review/inputs')
  inputs(@CurrentUser() user: CurrentUserType) {
    return this.aims.mgmtReviewInputs(user);
  }

  @Get('records')
  list(@CurrentUser() user: CurrentUserType, @Query('type') type?: string, @Query('org_id') orgId?: string) {
    return this.aims.list(user, type, orgId);
  }

  @Get('records/:id')
  get(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.aims.get(user, id);
  }

  @Patch('records/:id')
  @Roles(...AIMS_EDITORS)
  update(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>) {
    return this.aims.update(user, id, body);
  }

  @Post('records/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(...AIMS_EDITORS)
  approve(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Req() req: any) {
    return this.aims.approve(user, id, req);
  }

  @Post(':type')
  @Roles(...AIMS_EDITORS)
  create(@CurrentUser() user: CurrentUserType, @Param('type') type: string, @Body() body: Record<string, any>) {
    return this.aims.create(user, type, body);
  }
}
