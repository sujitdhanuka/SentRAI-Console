import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { AuthService } from './auth.service';
import { AuthUserResponse, LoginDto, RefreshDto, RegisterDto, TokenResponse } from './dto/auth.dto';

@ApiTags('Authentication')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('token')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<TokenResponse> {
    return this.auth.login(dto.username, dto.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto): Promise<TokenResponse> {
    return this.auth.refresh(dto.refresh_token);
  }

  @Get('me')
  me(@CurrentUser() user: CurrentUserType): AuthUserResponse {
    return this.auth.me(user);
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto): Promise<AuthUserResponse> {
    return this.auth.register(dto);
  }
}
