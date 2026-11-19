import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Statement of Applicability entry per Annex A control (governance E3.1). */
@Entity({ name: 'soa_entries' })
export class SoaEntryEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 20 })
  annexRef!: string;

  @Column('boolean')
  included!: boolean;

  @Column('text', { nullable: true })
  justification!: string | null;

  @Column('varchar', { length: 30, nullable: true })
  manualStatus!: string | null;

  @Column('text', { nullable: true })
  manualNote!: string | null;

  @Column('varchar', { length: 255 })
  updatedBy!: string;

  @Column('datetime')
  updatedAt!: Date;
}
