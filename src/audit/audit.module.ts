import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AIAuditTrailEntity,
  AIModelEntity,
  AuditEventEntity,
  ExplainabilityRecordEntity,
  ProjectEntity,
} from '../database/entities';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditEventsInterceptor } from './audit-events.interceptor';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AIAuditTrailEntity,
      AIModelEntity,
      ExplainabilityRecordEntity,
      AuditEventEntity,
      ProjectEntity,
    ]),
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    // Global: every mutating request across all modules lands in audit_events.
    { provide: APP_INTERCEPTOR, useClass: AuditEventsInterceptor },
  ],
})
export class AuditModule {}
