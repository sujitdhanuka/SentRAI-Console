import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** A deployer of a model the organisation develops (Colorado developer duties, governance E3.2). */
@Entity({ name: 'model_deployers' })
export class ModelDeployerEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('varchar', { length: 200 })
  name!: string;

  @Column('varchar', { length: 255, nullable: true })
  contact!: string | null;

  @Column('boolean')
  active!: boolean;

  @Column('varchar', { length: 255 })
  addedBy!: string;

  @Column('datetime')
  addedAt!: Date;
}
