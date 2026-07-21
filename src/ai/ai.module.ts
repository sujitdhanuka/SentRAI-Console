import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AiProviderConfigEntity, OrganizationEntity } from '../database/entities';
import { AiProvidersController } from './ai-providers.controller';
import { AiProvidersService } from './ai-providers.service';

@Module({
  imports: [TypeOrmModule.forFeature([AiProviderConfigEntity, OrganizationEntity])],
  controllers: [AiProvidersController],
  providers: [AiProvidersService],
  exports: [AiProvidersService],
})
export class AiModule {}
