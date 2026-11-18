import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** A completion of a course by one person (governance E2.6). */
@Entity({ name: 'training_records' })
export class TrainingRecordEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  courseId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  userId!: string;

  @Column('datetime')
  completedAt!: Date;

  @Column('datetime', { nullable: true })
  expiresAt!: Date | null;

  @Column('varchar', { length: 36, nullable: true })
  evidenceDocId!: string | null;

  @Column('varchar', { length: 500, nullable: true })
  evidenceRef!: string | null;

  @Column('varchar', { length: 255 })
  recordedBy!: string;

  @Column('datetime')
  createdAt!: Date;
}
