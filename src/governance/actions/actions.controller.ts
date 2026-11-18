import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { RISK_WRITERS } from '../risks/risks.service';
import { CorrectiveActionsService } from './actions.service';

/** Corrective-action register (E1.7). 404 unless GOV_E1_7_ACTIONS is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@Controller('api/v1/governance/actions')
export class CorrectiveActionsController {
  constructor(private readonly ca: CorrectiveActionsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserType, @Query() q: Record<string, string>) {
    return this.ca.list(user, q);
  }

  @Get(':id')
  get(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.ca.get(user, id);
  }

  /** Raise an action, optionally from an incident, audit, grievance, failed control or review. */
  @Post()
  @Roles(...RISK_WRITERS)
  create(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>) {
    return this.ca.create(user, body);
  }

  @Patch(':id')
  @Roles(...RISK_WRITERS)
  update(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.ca.update(user, id, body, req);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @Roles(...RISK_WRITERS)
  close(@CurrentUser() user: CurrentUserType, @Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return this.ca.close(user, id, body, req);
  }
}
