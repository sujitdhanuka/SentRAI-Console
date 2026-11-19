import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** An approved, frozen version of the Statement of Applicability (governance E3.1). */
@Entity({ name: 'soa_statements' })
@Index('UQ_soa_statements_org_version', ['orgId', 'version'], { unique: true })
export class SoaStatementEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Column('int')
  version!: number;

  @Column('simple-json')
  content!: any;

  @Column('varchar', { length: 64 })
  contentHash!: string;

  @Column('varchar', { length: 255 })
  approvedBy!: string;

  @Column('datetime')
  approvedAt!: Date;

  @Column('text', { nullable: true })
  note!: string | null;
}
