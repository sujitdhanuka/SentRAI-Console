import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Platform user with an RBAC role and optional tenant (organization) binding. */
@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  // `unique: true` on the column already creates the unique index; a separate
  // @Index({unique:true}) generated a SECOND index with the same auto name,
  // which MariaDB rejects on sync as "Duplicate key name" (SQLite tolerated it).
  @Column('varchar', { length: 320, unique: true })
  email!: string;

  @Column('varchar', { length: 255 })
  fullName!: string;

  @Column('varchar', { length: 255 })
  hashedPassword!: string;

  @Column('varchar', { length: 50, default: 'VIEWER' })
  role!: string;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  tenantId!: string | null;

  @Column('boolean', { default: true })
  isActive!: boolean;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
