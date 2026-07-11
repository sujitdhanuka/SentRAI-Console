import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { Role } from '../common/enums';
import { UsersService } from './users.service';
import { AddUserDto, ResetPasswordDto, UserResponse } from './users.dto';

@ApiTags('Users')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('api/v1/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() admin: CurrentUserType): Promise<UserResponse[]> {
    return this.users.list(admin);
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
}
