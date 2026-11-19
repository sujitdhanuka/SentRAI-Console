import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** One webhook delivery attempt (governance E3.3). */
@Entity({ name: 'integration_deliveries' })
export class IntegrationDeliveryEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Index()
  @Column('varchar', { length: 36 })
  endpointId!: string;

  @Column('varchar', { length: 60 })
  event!: string;

  @Column('varchar', { length: 100, nullable: true })
  refId!: string | null;

  @Column('varchar', { length: 20 })
  status!: string;

  @Column('int', { nullable: true })
  httpStatus!: number | null;

  @Column('varchar', { length: 500, nullable: true })
  error!: string | null;

  @Column('varchar', { length: 64 })
  payloadHash!: string;

  @Column('datetime')
  createdAt!: Date;
}
