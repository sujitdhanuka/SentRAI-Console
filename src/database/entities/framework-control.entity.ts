import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Model card v2: one control (or obligation) of one framework registry
 * revision. Written with the revision and never changed afterwards. The title
 * is our own one-line paraphrase, never the text of the standard or law.
 */
@Entity({ name: 'framework_controls' })
@Index('UQ_framework_controls_fw_rev_control', ['frameworkId', 'frameworkRevision', 'controlId'], { unique: true })
export class FrameworkControlEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Column('varchar', { length: 64 })
  frameworkId!: string;

  @Column('int')
  frameworkRevision!: number;

  @Column('varchar', { length: 64 })
  controlId!: string;

  @Column('varchar', { length: 255 })
  title!: string;

  @Column('varchar', { length: 40 })
  verificationStatus!: string;

  @Column('simple-json')
  definition!: any;
}
