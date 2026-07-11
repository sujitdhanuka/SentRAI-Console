import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Platform user with an RBAC role and optional tenant (organization) binding. */
@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index({ unique: true })
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
