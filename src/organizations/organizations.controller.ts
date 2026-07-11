import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { Role } from '../common/enums';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto, OrganizationResponse } from './organizations.dto';

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
}
