import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** A link from a model to a dataset it was trained, validated or tested on, or reads at inference (governance E2.7). */
@Entity({ name: 'model_datasets' })
export class ModelDatasetEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  datasetId!: string;

  @Column('varchar', { length: 20 })
  purpose!: string;

  @Column('varchar', { length: 255 })
  linkedBy!: string;

  @Column('datetime')
  linkedAt!: Date;
}
