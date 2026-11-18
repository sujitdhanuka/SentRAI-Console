import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** A training course or policy acknowledgement with target roles and validity (governance E2.6). */
@Entity({ name: 'training_courses' })
export class TrainingCourseEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  orgId!: string;

  @Column('varchar', { length: 300 })
  title!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('varchar', { length: 20 })
  kind!: string;

  @Column('simple-json')
  targetRoles!: any;

  @Column('int', { nullable: true })
  validityMonths!: number | null;

  @Column('boolean')
  mandatory!: boolean;

  @Column('varchar', { length: 50, nullable: true })
  topic!: string | null;

  @Column('varchar', { length: 36, nullable: true })
  documentId!: string | null;

  @Column('boolean')
  active!: boolean;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
