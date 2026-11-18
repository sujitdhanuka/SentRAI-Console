import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A recorded control evaluation (governance E1.1). One row per control per
 * evaluation, however many packs map to it: evidence attaches to the control,
 * and each pack reports it under its own clause codes. modelId is null for
 * organisation-level (ORG) controls.
 */
@Entity({ name: 'control_results' })
export class ControlResultEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  orgId!: string | null;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  modelId!: string | null;

  @Column('varchar', { length: 40 })
  controlId!: string;

  /** PASS | FAIL | NOT_ASSESSED */
  @Column('varchar', { length: 20 })
  status!: string;

  @Column('simple-json', { nullable: true })
  evidenceRefs!: string[] | null;

  /** Clauses this result was reported under, e.g. ["nist-ai-rmf:GOVERN-2.1", "iso-42001:AIMS-5.3"]. */
  @Column('simple-json', { nullable: true })
  clauses!: string[] | null;

  /** Pack versions in force for the evaluation, e.g. {"nist-ai-rmf": "1.0.0"}. */
  @Column('simple-json')
  packVersionSet!: Record<string, string>;

  @Column('varchar', { length: 255 })
  evaluatedBy!: string;

  @Index()
  @Column('datetime')
  evaluatedAt!: Date;
}
