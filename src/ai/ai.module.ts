import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AiProviderConfigEntity, OrganizationEntity, PromptTemplateEntity } from '../database/entities';
import { AiProvidersController } from './ai-providers.controller';
import { AiProvidersService } from './ai-providers.service';
import { PromptVaultController } from './prompt-vault.controller';
import { PromptVaultService } from './prompt-vault.service';

@Module({
  imports: [TypeOrmModule.forFeature([AiProviderConfigEntity, PromptTemplateEntity, OrganizationEntity])],
  controllers: [AiProvidersController, PromptVaultController],
  providers: [AiProvidersService, PromptVaultService],
  exports: [AiProvidersService, PromptVaultService],
})
export class AiModule {}
