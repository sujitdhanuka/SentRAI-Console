import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * EU AI Act workspace record (governance E5.1). One table for the per-system
 * EU profile and every EU record kind: PROFILE (scope, roles, Art. 5
 * screening, Annex III classification and the Annex IV / Art. 13 / Art. 50 /
 * Art. 26 fields), CONFORMITY (Annex VI / VII), DECLARATION (Annex V),
 * REGISTRATION (Annex VIII), NONCONFORMITY (Art. 20), CHANGE (Art. 25
 * substantial-modification assessment), RWT_PLAN (Art. 60), EXPLANATION
 * (Art. 86) and ORG (authorised representative, log retention).
 */
@Entity({ name: 'eu_act_records' })
export class EuActRecordEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  modelId!: string | null;

  @Column('varchar', { length: 20 })
  kind!: string;

  @Column('varchar', { length: 30 })
  status!: string;

  @Column('simple-json')
  data!: any;

  @Column('varchar', { length: 64, nullable: true })
  contentHash!: string | null;

  @Column('varchar', { length: 255, nullable: true })
  signedBy!: string | null;

  @Column('datetime', { nullable: true })
  signedAt!: Date | null;

  @Column('datetime', { nullable: true })
  dueAt!: Date | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
