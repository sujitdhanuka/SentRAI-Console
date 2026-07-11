import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A tracked application/codebase. Each project owns its own scan history and
 * scoped model inventory.
 */
@Entity({ name: 'projects' })
export class ProjectEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Column('varchar', { length: 255, unique: true })
  name!: string;

  @Column('text', { default: '' })
  description!: string;

  @Column('varchar', { length: 1000 })
  rootDirectory!: string;

  @Column('datetime', { nullable: true })
  lastScannedAt!: Date | null;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  tenantId!: string | null;
}
