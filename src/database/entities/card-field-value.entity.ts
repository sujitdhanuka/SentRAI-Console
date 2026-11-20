import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Model card v2: one field value of one record (catalogue field id). One row
 * per record and field, so any field is queryable across cards by
 * (orgId, fieldId). A missing row reads as NOT_ASSESSED. History lives in the
 * model ledger (CARD_FIELD_CHANGED events with before and after).
 */
@Entity({ name: 'card_field_values' })
@Index('UQ_card_field_values_model_field', ['modelId', 'fieldId'], { unique: true })
@Index('IDX_card_field_values_org_field', ['orgId', 'fieldId'])
export class CardFieldValueEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('varchar', { length: 80 })
  fieldId!: string;

  @Column('simple-json', { nullable: true })
  value!: any;

  @Column('varchar', { length: 20 })
  status!: string;

  @Column('varchar', { length: 20, nullable: true })
  provenance!: string | null;

  @Column('varchar', { length: 500, nullable: true })
  sourceRef!: string | null;

  @Column('varchar', { length: 255, nullable: true })
  enteredBy!: string | null;

  @Column('datetime', { nullable: true })
  enteredAt!: Date | null;

  @Column('varchar', { length: 255, nullable: true })
  acceptedBy!: string | null;

  @Column('datetime', { nullable: true })
  acceptedAt!: Date | null;

  /** Pending AI or code-scan suggestion, kept apart from the value. */
  @Column('simple-json', { nullable: true })
  suggestion!: any;

  @Column('text', { nullable: true })
  naJustification!: string | null;

  @Column('varchar', { length: 255, nullable: true })
  naDecidedBy!: string | null;

  @Column('simple-json', { nullable: true })
  evidenceRefs!: any[] | null;

  @Column('varchar', { length: 255, nullable: true })
  verifiedBy!: string | null;

  @Column('datetime', { nullable: true })
  verifiedAt!: Date | null;

  @Column('varchar', { length: 20 })
  catalogueVersion!: string;

  @Column('datetime')
  updatedAt!: Date;
}
