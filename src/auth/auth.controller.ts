import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { AuthService } from './auth.service';
import { AuthUserResponse, LoginDto, RefreshDto, RegisterDto, TokenResponse } from './dto/auth.dto';

@ApiTags('Authentication')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Tight limit on credential submission — resists brute-force / spraying.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
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

  /** Public, secret-free bootstrap diagnostics (build tag + seed-admin state). */
  @Public()
  @Get('bootstrap-status')
  bootstrapStatus() {
    return this.auth.bootstrapStatus();
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto): Promise<AuthUserResponse> {
    return this.auth.register(dto);
  }
}
