import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** One component of a model's AI bill of materials (governance E2.5): upstream model, library, API or dataset, its version and licence. */
@Entity({ name: 'ai_bom_items' })
export class AiBomItemEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  vendorId!: string | null;

  @Column('varchar', { length: 200 })
  component!: string;

  @Column('varchar', { length: 20 })
  kind!: string;

  @Column('varchar', { length: 100, nullable: true })
  provider!: string | null;

  @Column('varchar', { length: 100, nullable: true })
  version!: string | null;

  @Column('varchar', { length: 100, nullable: true })
  licence!: string | null;

  @Column('varchar', { length: 20 })
  licenceClass!: string;

  @Column('varchar', { length: 20 })
  source!: string;

  @Column('datetime', { nullable: true })
  lastChangeAt!: Date | null;

  @Column('varchar', { length: 100, nullable: true })
  previousVersion!: string | null;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
