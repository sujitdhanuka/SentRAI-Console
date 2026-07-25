import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** One recorded decision within an approval request. */
export interface ApprovalDecision {
  actor: string;
  role: string;
  decision: 'APPROVE' | 'REJECT';
  note: string | null;
  decidedAt: string;
}

/**
 * A review-board sign-off request for promoting a model to a live stage
 * (Pillar 1 — Alignment). Mirrors how an institution's AI governance board
 * actually sanctions a system: an owner requests go-live, one or more
 * independent approvers (never the requester) record a decision, and only an
 * APPROVED request unlocks the lifecycle gate. Every state change is also
 * written to the model ledger, so the approval is part of the immutable audit
 * trail — not a soft flag that can be edited away.
 */
@Entity({ name: 'model_approvals' })
export class ModelApprovalEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  /** Denormalised from the model's project for tenant-scoped listing. */
  @Index()
  @Column('varchar', { length: 36, nullable: true })
  tenantId!: string | null;

  /** Snapshot at request time — the model may be renamed/re-triaged later. */
  @Column('varchar', { length: 200 })
  modelName!: string;

  @Column('varchar', { length: 20 })
  riskLevel!: string;

  /** The live stage the requester wants to reach (DEPLOYED / MONITORING). */
  @Column('varchar', { length: 30 })
  targetStage!: string;

  @Index()
  @Column('varchar', { length: 20 })
  status!: string; // PENDING | APPROVED | REJECTED | WITHDRAWN

  /** Quorum: how many APPROVE decisions are needed to reach APPROVED. */
  @Column('int', { default: 1 })
  requiredApprovals!: number;

  @Column('varchar', { length: 255 })
  requestedBy!: string;

  @Column('varchar', { length: 30 })
  requestedByRole!: string;

  @Column('varchar', { length: 1000, nullable: true })
  requestNote!: string | null;

  @Column('simple-json')
  decisions!: ApprovalDecision[];

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime', { nullable: true })
  resolvedAt!: Date | null;
}
