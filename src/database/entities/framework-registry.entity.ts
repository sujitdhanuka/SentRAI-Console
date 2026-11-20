import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Model card v2: one revision of one framework registry entry (spec §2).
 * Edits never overwrite: each change is a new revision row, and control
 * assessments pin the revision they were made against. Seeded rows are
 * UNVERIFIED_REQUIRES_LEGAL_REVIEW. `definition` holds the whole entry
 * (identifiers, dates and our own paraphrases only).
 */
@Entity({ name: 'framework_registry' })
@Index('UQ_framework_registry_id_revision', ['frameworkId', 'revision'], { unique: true })
export class FrameworkRegistryEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Column('varchar', { length: 64 })
  frameworkId!: string;

  @Column('int')
  revision!: number;

  /** STANDARD, LAW, REGULATION or GUIDANCE. */
  @Column('varchar', { length: 20 })
  type!: string;

  @Column('varchar', { length: 255 })
  title!: string;

  @Column('varchar', { length: 40 })
  verificationStatus!: string;

  @Column('simple-json')
  definition!: any;

  /** Why this revision was made (the seed, or the officer's reason). */
  @Column('text')
  reason!: string;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;
}
