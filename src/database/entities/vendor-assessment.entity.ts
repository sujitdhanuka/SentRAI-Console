import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** A versioned vendor due-diligence checklist (governance E2.5). */
@Entity({ name: 'vendor_assessments' })
export class VendorAssessmentEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  vendorId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Column('int')
  version!: number;

  @Column('simple-json')
  answers!: any;

  @Column('int')
  score!: number;

  @Column('varchar', { length: 20 })
  result!: string;

  @Column('simple-json', { nullable: true })
  gaps!: any | null;

  @Column('text', { nullable: true })
  notes!: string | null;

  @Column('varchar', { length: 255 })
  assessedBy!: string;

  @Column('datetime')
  assessedAt!: Date;
}
