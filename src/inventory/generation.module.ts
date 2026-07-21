import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIModelEntity } from '../database/entities';
import { GenerationQueueService } from './generation-queue.service';

/**
 * The auto-generation queue on its own, depending on nothing but the model
 * repository. Both discovery (after import) and inventory (after re-scan) need
 * to enqueue work, and inventory wires the runner — keeping the queue in a
 * standalone global module avoids a circular module graph between the two.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AIModelEntity])],
  providers: [GenerationQueueService],
  exports: [GenerationQueueService],
})
export class GenerationModule {}
