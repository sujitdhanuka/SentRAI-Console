import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** A versioned AI threat model for one system (governance E3.6). */
@Entity({ name: 'threat_models' })
@Index('UQ_threat_models_model_version', ['modelId', 'version'], { unique: true })
export class ThreatModelEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('int')
  version!: number;

  @Column('varchar', { length: 60 })
  templateId!: string;

  @Column('simple-json')
  threats!: any;

  @Column('varchar', { length: 20 })
  status!: string;

  @Column('varchar', { length: 255, nullable: true })
  approvedBy!: string | null;

  @Column('datetime', { nullable: true })
  approvedAt!: Date | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
