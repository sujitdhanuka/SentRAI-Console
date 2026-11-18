import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * An organisation-level AI management system record (governance E1.6):
 * scope, AI policy, context, interested parties, objectives, management
 * review, internal audit programme, resources, communication, changes, and
 * light competence / awareness records. ORG-scope controls read these.
 */
@Entity({ name: 'aims_records' })
export class AimsRecordEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 30 })
  type!: string;

  @Column('varchar', { length: 300 })
  title!: string;

  @Column('simple-json')
  content!: Record<string, any>;

  /** DRAFT | APPROVED | RETIRED */
  @Column('varchar', { length: 20 })
  status!: string;

  @Column('varchar', { length: 36, nullable: true })
  ownerUserId!: string | null;

  @Column('varchar', { length: 255, nullable: true })
  approvedBy!: string | null;

  @Column('datetime', { nullable: true })
  approvedAt!: Date | null;

  @Column('datetime', { nullable: true })
  reviewDueAt!: Date | null;

  /** Controlled document backing the record (E1.8), e.g. the signed AI policy. */
  @Column('varchar', { length: 36, nullable: true })
  documentId!: string | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
