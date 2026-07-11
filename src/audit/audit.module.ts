import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIAuditTrailEntity, AIModelEntity } from '../database/entities';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([AIAuditTrailEntity, AIModelEntity])],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
