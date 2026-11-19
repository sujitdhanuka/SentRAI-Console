import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** ITSM or SIEM webhook for incidents and runtime alerts (governance E3.3). */
@Entity({ name: 'integration_endpoints' })
export class IntegrationEndpointEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Column('varchar', { length: 30 })
  kind!: string;

  @Column('varchar', { length: 200 })
  label!: string;

  @Column('varchar', { length: 1000 })
  url!: string;

  @Column('text', { nullable: true })
  secretEncrypted!: string | null;

  @Column('simple-json')
  events!: any;

  @Column('boolean')
  enabled!: boolean;

  @Column('datetime', { nullable: true })
  lastDeliveryAt!: Date | null;

  @Column('varchar', { length: 20, nullable: true })
  lastStatus!: string | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
