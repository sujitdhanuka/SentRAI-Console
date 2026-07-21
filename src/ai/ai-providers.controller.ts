import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { Role } from '../common/enums';
import { AiProvidersService } from './ai-providers.service';
import { CreateProviderDto, ProviderResponse, TestResult, UpdateProviderDto } from './ai.dto';

/**
 * Per-organization AI provider registry (BYO-LLM). Choosing where model code
 * snippets are sent is a governance decision, so this surface is limited to
 * governance roles. API keys are write-only: no endpoint returns one, ever.
 */
@ApiTags('AI Providers')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.CISO, Role.OWNER)
@Controller('api/v1/ai/providers')
export class AiProvidersController {
  constructor(private readonly providers: AiProvidersService) {}

  @Get()
  list(
    @CurrentUser() user: CurrentUserType,
    @Query('organization_id') organizationId?: string,
  ): Promise<ProviderResponse[]> {
    return this.providers.list(user, organizationId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateProviderDto): Promise<ProviderResponse> {
    return this.providers.create(user, dto);
  }

  @Patch(':providerId')
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('providerId') providerId: string,
    @Body() dto: UpdateProviderDto,
  ): Promise<ProviderResponse> {
    return this.providers.update(user, providerId, dto);
  }

  @Delete(':providerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: CurrentUserType, @Param('providerId') providerId: string): Promise<void> {
    return this.providers.remove(user, providerId);
  }

  /** 1-token live completion — validates URL, key, and model in one shot. */
  @Post(':providerId/test')
  @HttpCode(HttpStatus.OK)
  test(@CurrentUser() user: CurrentUserType, @Param('providerId') providerId: string): Promise<TestResult> {
    return this.providers.test(user, providerId);
  }
}
