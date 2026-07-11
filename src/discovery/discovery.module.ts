import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AIAuditTrailEntity,
  AIIncidentEntity,
  AIModelEntity,
  DriftReportEntity,
  ModelLedgerEventEntity,
  ProjectEntity,
  PromptEntity,
} from '../database/entities';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { TreeSitterService } from './tree-sitter-parser';
import { Neo4jClient } from './neo4j-client';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AIModelEntity,
      ProjectEntity,
      ModelLedgerEventEntity,
      PromptEntity,
      AIIncidentEntity,
      DriftReportEntity,
      AIAuditTrailEntity,
    ]),
  ],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, TreeSitterService, Neo4jClient],
  exports: [TreeSitterService],
})
export class DiscoveryModule {}
