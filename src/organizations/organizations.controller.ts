import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { Role } from '../common/enums';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto, OrganizationResponse, UpdatePlanDto } from './organizations.dto';

@ApiTags('Organizations')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('api/v1/organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserType): Promise<OrganizationResponse[]> {
    return this.orgs.list(user);
  }

  @Post()
  create(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: CreateOrganizationDto,
  ): Promise<OrganizationResponse> {
    return this.orgs.create(user, dto);
  }

  /** Change an organization's pricing plan (soft limits only — never blocks). */
  @Patch(':orgId/plan')
  updatePlan(
    @CurrentUser() user: CurrentUserType,
    @Param('orgId') orgId: string,
    @Body() dto: UpdatePlanDto,
  ): Promise<OrganizationResponse> {
    return this.orgs.updatePlan(user, orgId, dto);
  }
}
