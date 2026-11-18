import { Body, Controller, Get, Param, Patch, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { AccountabilityService } from './accountability.service';
import { ActingOrgInterceptor } from '../acting-org.interceptor';

/** Accountability (E1.9). 404 unless GOV_E1_9_ACCOUNTABILITY is on. */
@ApiTags('Governance')
@ApiBearerAuth()
@UseInterceptors(ActingOrgInterceptor)
@Controller('api/v1')
export class AccountabilityController {
  constructor(private readonly svc: AccountabilityService) {}

  @Get('organizations/:orgId/accountability')
  get(@CurrentUser() user: CurrentUserType, @Param('orgId') orgId: string) {
    return this.svc.get(user, orgId);
  }

  @Patch('organizations/:orgId/accountability')
  @Roles(Role.OWNER, Role.CISO)
  update(@CurrentUser() user: CurrentUserType, @Param('orgId') orgId: string, @Body() body: Record<string, any>) {
    return this.svc.update(user, orgId, body);
  }

  @Get('organizations/:orgId/owner-register')
  register(@CurrentUser() user: CurrentUserType, @Param('orgId') orgId: string) {
    return this.svc.ownerRegister(user, orgId);
  }

  @Patch('inventory/models/:modelId/owner')
  @Roles(Role.OWNER, Role.CISO, Role.ADMIN)
  setOwner(@CurrentUser() user: CurrentUserType, @Param('modelId') modelId: string, @Body() body: Record<string, any>) {
    return this.svc.setModelOwner(user, modelId, body.owner_user_id ?? null, body.reason);
  }
}
