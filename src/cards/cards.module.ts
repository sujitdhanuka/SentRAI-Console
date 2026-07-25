import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIModelEntity } from '../database/entities';
import { GrievancesModule } from '../grievances/grievances.module';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';

/** Pillar 5 — Societal: public consumer-facing transparency cards + the
 *  framework-as-data regime registry. */
@Module({
  imports: [TypeOrmModule.forFeature([AIModelEntity]), GrievancesModule],
  controllers: [CardsController],
  providers: [CardsService],
})
export class CardsModule {}
