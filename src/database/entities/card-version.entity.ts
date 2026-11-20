import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Model card v2: a frozen card version, written at final approval (and on
 * request). Kept apart from model_cards so v1 versions stay exactly as they
 * were and v1 code never reads v2 content. Never updated or deleted; a later
 * version supersedes it and the two can be compared.
 */
@Entity({ name: 'card_versions' })
@Index('UQ_card_versions_model_version', ['modelId', 'version'], { unique: true })
export class CardVersionEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('int')
  version!: number;

  /** APPROVED (final approval) or SNAPSHOT (taken on request, not approved). */
  @Column('varchar', { length: 20 })
  kind!: string;

  @Column('varchar', { length: 20 })
  workflowState!: string;

  @Column('simple-json')
  content!: any;

  @Column('varchar', { length: 64 })
  contentHash!: string;

  @Column('text', { nullable: true })
  reason!: string | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;
}
