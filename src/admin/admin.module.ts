import { Module } from '@nestjs/common';

import { AdminController } from './admin.controller';
import { DemoSeedService } from './demo-seed.service';

@Module({
  controllers: [AdminController],
  providers: [DemoSeedService],
  exports: [DemoSeedService],
})
export class AdminModule {}
