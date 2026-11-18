import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A controlled document version (governance E1.8, ISO 7.5): policies and
 * evidence with version, approver, review and retention dates and a content
 * hash. Versions of one document share a seriesId; superseded versions are
 * kept.
 */
@Entity({ name: 'documents' })
export class ControlledDocumentEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  seriesId!: string;

  /** POLICY | PROCEDURE | EVIDENCE | RECORD | REPORT | OTHER */
  @Column('varchar', { length: 20 })
  docType!: string;

  @Column('varchar', { length: 300 })
  title!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('int')
  version!: number;

  /** SHA-256 of the document content. */
  @Column('varchar', { length: 64 })
  hash!: string;

  @Column('varchar', { length: 1000 })
  uri!: string;

  /** DRAFT | APPROVED | SUPERSEDED | RETIRED */
  @Index()
  @Column('varchar', { length: 20 })
  status!: string;

  @Column('varchar', { length: 255, nullable: true })
  approvedBy!: string | null;

  @Column('datetime', { nullable: true })
  approvedAt!: Date | null;

  @Column('datetime', { nullable: true })
  reviewDueAt!: Date | null;

  @Column('datetime', { nullable: true })
  retentionUntil!: Date | null;

  @Column('varchar', { length: 36, nullable: true })
  supersedesId!: string | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
