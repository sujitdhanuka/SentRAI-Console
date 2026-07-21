import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { SummarizerService } from './summarizer.service';

@Module({
  imports: [AiModule], // org-registered AI providers take precedence over env config
  providers: [SummarizerService],
  exports: [SummarizerService],
})
export class SummarizerModule {}
