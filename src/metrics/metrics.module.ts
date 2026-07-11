import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIModelEntity, DriftReportEntity } from '../database/entities';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  imports: [TypeOrmModule.forFeature([AIModelEntity, DriftReportEntity])],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
