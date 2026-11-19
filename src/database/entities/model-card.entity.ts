import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A frozen model card version (governance E4.1). The live card is generated
 * from the model record on every read; freezing it stores the content as it
 * stood, with a hash per section, so a later change to the model can be
 * flagged as making this version stale.
 */
@Entity({ name: 'model_cards' })
@Index('UQ_model_cards_model_version', ['modelId', 'version'], { unique: true })
export class ModelCardEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  orgId!: string | null;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('int')
  version!: number;

  /** DRAFT (any time) or FINAL (required fields complete and the gates clear). */
  @Column('varchar', { length: 20 })
  status!: string;

  @Column('simple-json')
  content!: any;

  /** Hash of the whole card content (section hashes in the content). */
  @Column('varchar', { length: 64 })
  contentHash!: string;

  @Column('varchar', { length: 1000, nullable: true })
  note!: string | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;
}
