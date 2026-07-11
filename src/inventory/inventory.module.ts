import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIModelEntity, ModelLedgerEventEntity, ProjectEntity, PromptEntity } from '../database/entities';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { DiscoveryModule } from '../discovery/discovery.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AIModelEntity, ModelLedgerEventEntity, ProjectEntity, PromptEntity]),
    DiscoveryModule, // provides the shared TreeSitterService
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
