import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AiModule } from '../ai/ai.module';
import { AiUsageEventEntity } from '../database/entities';
import { SummarizerService } from './summarizer.service';

@Module({
  // AiModule: org-registered providers take precedence over env config.
  // AiUsageEventEntity: per-call metering rows.
  imports: [AiModule, TypeOrmModule.forFeature([AiUsageEventEntity])],
  providers: [SummarizerService],
  exports: [SummarizerService],
})
export class SummarizerModule {}
