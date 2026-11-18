import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** An SR 26-2 model validation (governance E2.3): scope, independent validator, conceptual soundness, outcomes analysis, findings and any temporary-use exception. */
@Entity({ name: 'model_validations' })
export class ModelValidationEntity {
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

  @Index()
  @Column('varchar', { length: 20 })
  status!: string;

  @Column('varchar', { length: 30, nullable: true })
  result!: string | null;

  @Column('varchar', { length: 36, nullable: true })
  validatorUserId!: string | null;

  @Column('varchar', { length: 255, nullable: true })
  validatorEmail!: string | null;

  @Column('boolean')
  independent!: boolean;

  @Column('simple-json', { nullable: true })
  independenceReasons!: any | null;

  @Column('text', { nullable: true })
  scope!: string | null;

  @Column('text', { nullable: true })
  conceptualSoundness!: string | null;

  @Column('text', { nullable: true })
  implementationReview!: string | null;

  @Column('text', { nullable: true })
  outcomesAnalysis!: string | null;

  @Column('boolean')
  vendorModel!: boolean;

  @Column('boolean')
  tempUseException!: boolean;

  @Column('text', { nullable: true })
  compensatingControls!: string | null;

  @Column('datetime', { nullable: true })
  exceptionExpiresAt!: Date | null;

  @Column('datetime', { nullable: true })
  expiresAt!: Date | null;

  @Column('simple-json', { nullable: true })
  findings!: any | null;

  @Column('datetime', { nullable: true })
  completedAt!: Date | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
