import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One model's slot in an attestation campaign. An owner/approver either ATTESTs
 * (the model is still within its sanctioned scope) or FLAGs it (something has
 * drifted and it needs review). Items left PENDING past the due date are
 * escalated by the scheduled job — the same overdue-escalation pattern the
 * incident reporter uses.
 */
@Entity({ name: 'attestation_items' })
export class AttestationItemEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  campaignId!: string;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  tenantId!: string | null;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('varchar', { length: 200 })
  modelName!: string;

  @Column('varchar', { length: 20 })
  riskLevel!: string;

  @Index()
  @Column('varchar', { length: 20 })
  status!: string; // PENDING | ATTESTED | FLAGGED

  @Column('varchar', { length: 255, nullable: true })
  attestedBy!: string | null;

  @Column('varchar', { length: 30, nullable: true })
  attestedByRole!: string | null;

  @Column('varchar', { length: 1000, nullable: true })
  note!: string | null;

  @Column('datetime')
  dueAt!: Date;

  @Column('datetime', { nullable: true })
  attestedAt!: Date | null;

  @Column('datetime')
  createdAt!: Date;
}
