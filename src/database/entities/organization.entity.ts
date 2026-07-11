import { Column, Entity, PrimaryColumn } from 'typeorm';

/** A tenant organization. Partitions projects, models, and users. */
@Entity({ name: 'organizations' })
export class OrganizationEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Column('varchar', { length: 255, unique: true })
  name!: string;

  @Column('text', { default: '' })
  description!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
