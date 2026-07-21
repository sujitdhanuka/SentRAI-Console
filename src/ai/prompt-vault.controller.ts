import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { Role } from '../common/enums';
import { PromptVaultService } from './prompt-vault.service';

class SavePromptDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  change_note?: string;

  @IsOptional()
  @IsString()
  organization_id?: string;
}

class OrgScopeDto {
  @IsOptional()
  @IsString()
  organization_id?: string;
}

/** Editable, versioned prompt vault — same governance-role surface as the
 *  provider registry (prompts steer what the AI writes into audit evidence). */
@ApiTags('AI Prompt Vault')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.CISO, Role.OWNER)
@Controller('api/v1/ai/prompts')
export class PromptVaultController {
  constructor(private readonly vault: PromptVaultService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserType, @Query('organization_id') organizationId?: string) {
    return this.vault.list(user, organizationId);
  }

  @Get(':useCase/history')
  history(
    @CurrentUser() user: CurrentUserType,
    @Param('useCase') useCase: string,
    @Query('organization_id') organizationId?: string,
  ) {
    return this.vault.history(user, useCase, organizationId);
  }

  @Put(':useCase')
  save(
    @CurrentUser() user: CurrentUserType,
    @Param('useCase') useCase: string,
    @Body() dto: SavePromptDto,
  ) {
    return this.vault.save(user, useCase, dto.body, dto.change_note, dto.organization_id);
  }

  @Post(':useCase/restore/:version')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentUser() user: CurrentUserType,
    @Param('useCase') useCase: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: OrgScopeDto,
  ) {
    return this.vault.restore(user, useCase, version, dto?.organization_id);
  }

  @Post(':useCase/reset')
  @HttpCode(HttpStatus.OK)
  reset(
    @CurrentUser() user: CurrentUserType,
    @Param('useCase') useCase: string,
    @Body() dto: OrgScopeDto,
  ) {
    return this.vault.reset(user, useCase, dto?.organization_id);
  }
}
