import { Body, Controller, Get, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { orgScope } from '../governance-access';
import { GovernanceSettingsService } from './settings.service';

/**
 * Governance settings window (E1.2). Read by anyone in the organisation;
 * changed only by its Owner or CISO (the platform ADMIN can read any org with
 * ?org_id= but cannot change a customer's risk appetite). 404 while off.
 */
@ApiTags('Governance')
@ApiBearerAuth()
@Controller('api/v1/governance/settings')
export class GovernanceSettingsController {
  constructor(private readonly settings: GovernanceSettingsService) {}

  @Get()
  get(@CurrentUser() user: CurrentUserType, @Query('as_of') asOf?: string, @Query('org_id') orgId?: string) {
    return this.settings.get(user, orgScope(user, orgId), asOf);
  }

  @Get('history')
  history(@CurrentUser() user: CurrentUserType, @Query('org_id') orgId?: string) {
    return this.settings.history(orgScope(user, orgId));
  }

  @Put()
  @Roles(Role.OWNER, Role.CISO)
  update(@CurrentUser() user: CurrentUserType, @Body() body: Record<string, any>, @Req() req: any, @Query('org_id') orgId?: string) {
    // Naming another organisation is a 403 in the service: settings belong to the caller's own org.
    return this.settings.update(user, orgId || orgScope(user), body, req);
  }
}
