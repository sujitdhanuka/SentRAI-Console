import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AiProviderConfigEntity,
  AIModelEntity,
  AiUsageEventEntity,
  ModelLedgerEventEntity,
  OrganizationEntity,
  ProjectEntity,
  PromptTemplateEntity,
} from '../database/entities';
import { AiProvidersController, AiUsageController } from './ai-providers.controller';
import { AiProvidersService } from './ai-providers.service';
import { PromptVaultController } from './prompt-vault.controller';
import { PromptVaultService } from './prompt-vault.service';

@Module({
  imports: [TypeOrmModule.forFeature([
    AiProviderConfigEntity,
    PromptTemplateEntity,
    AiUsageEventEntity,
    OrganizationEntity,
    ProjectEntity, // self-governance: providers register into the org inventory
    AIModelEntity,
    ModelLedgerEventEntity,
  ])],
  controllers: [AiProvidersController, AiUsageController, PromptVaultController],
  providers: [AiProvidersService, PromptVaultService],
  exports: [AiProvidersService, PromptVaultService],
})
export class AiModule {}
