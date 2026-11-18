import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { Role } from '../common/enums';
import { UsersService } from './users.service';
import { AddUserDto, AssignableOrganization, ResetPasswordDto, UpdateUserDto, UserResponse } from './users.dto';

// ADMIN is a global user administrator; OWNER administers users within their
// own organization. All tenant-scoping and the role ceiling (no OWNER-minted
// ADMINs) are enforced in the service.
@ApiTags('Users')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.OWNER)
@Controller('api/v1/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() admin: CurrentUserType): Promise<UserResponse[]> {
    return this.users.list(admin);
  }

  /** Organizations the caller may place users in (all for a global admin, own org otherwise). */
  @Get('organizations')
  organizations(@CurrentUser() admin: CurrentUserType): Promise<AssignableOrganization[]> {
    return this.users.assignableOrganizations(admin);
  }

  @Post()
  add(@CurrentUser() admin: CurrentUserType, @Body() dto: AddUserDto): Promise<UserResponse> {
    return this.users.add(admin, dto);
  }

  @Patch(':userId/reset-password')
  resetPassword(
    @CurrentUser() admin: CurrentUserType,
    @Param('userId') userId: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.users.resetPassword(admin, userId, dto);
  }

  /** Change a user's name, role, organization, or active status. */
  @Patch(':userId')
  update(
    @CurrentUser() admin: CurrentUserType,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponse> {
    return this.users.update(admin, userId, dto);
  }

  /** Permanently remove a user. */
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() admin: CurrentUserType, @Param('userId') userId: string): Promise<void> {
    return this.users.remove(admin, userId);
  }
}
