import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotifierService } from '../common/notifier.service';
import { LeadEntity } from '../database/entities';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

/** Landing-page contact messages and demo bookings, reviewed by the platform admin. */
@Module({
  imports: [TypeOrmModule.forFeature([LeadEntity])],
  controllers: [LeadsController],
  providers: [LeadsService, NotifierService],
})
export class LeadsModule {}
