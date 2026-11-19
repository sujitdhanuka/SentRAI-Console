import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** No-training and retention attestation for one AI provider configuration (governance E3.8). */
@Entity({ name: 'ai_provider_attestations' })
export class AiProviderAttestationEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  providerId!: string;

  @Column('boolean')
  noTraining!: boolean;

  @Column('int', { nullable: true })
  retentionDays!: number | null;

  @Column('varchar', { length: 500 })
  reference!: string;

  /** The provider's host and model when attested; a later change to either voids the attestation. */
  @Column('varchar', { length: 500 })
  endpoint!: string;

  @Column('varchar', { length: 36, nullable: true })
  documentId!: string | null;

  @Column('varchar', { length: 255 })
  attestedBy!: string;

  @Column('datetime')
  attestedAt!: Date;

  @Column('datetime', { nullable: true })
  expiresAt!: Date | null;

  @Column('datetime', { nullable: true })
  revokedAt!: Date | null;
}
