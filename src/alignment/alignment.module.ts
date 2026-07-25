import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AIModelEntity,
  AttestationCampaignEntity,
  AttestationItemEntity,
  ModelApprovalEntity,
  ModelLedgerEventEntity,
  ProjectEntity,
} from '../database/entities';
import { NotifierService } from '../common/notifier.service';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { AttestationsController } from './attestations.controller';
import { AttestationsService } from './attestations.service';

/**
 * Pillar 1 — Alignment: the review-board approval workflow and attestation
 * campaigns that keep every AI system doing what the institution sanctioned.
 * AttestationsService is exported so the scheduled-tasks module can escalate
 * overdue attestations on the same cron pattern the incident reporter uses.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ModelApprovalEntity,
      AttestationCampaignEntity,
      AttestationItemEntity,
      AIModelEntity,
      ProjectEntity,
      ModelLedgerEventEntity,
    ]),
  ],
  controllers: [ApprovalsController, AttestationsController],
  providers: [ApprovalsService, AttestationsService, NotifierService],
  exports: [AttestationsService],
})
export class AlignmentModule {}
