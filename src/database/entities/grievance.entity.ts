import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A consumer grievance about an AI system (Roadmap Pillar 5 — Societal). Where
 * the old model counter only tallied complaints, this is a first-class record
 * with a state machine (RECEIVED → ACKNOWLEDGED → INVESTIGATING → RESOLVED /
 * REJECTED → CLOSED) and an SLA deadline — the redress mechanism RBI FREE-AI and
 * the EU AI Act expect an institution to run for the people its AI affects.
 */
@Entity({ name: 'grievances' })
export class GrievanceEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  tenantId!: string | null;

  @Column('varchar', { length: 200 })
  subject!: string;

  @Column('text')
  description!: string;

  /** Optional complainant contact — stored masked; never required to file. */
  @Column('varchar', { length: 255, nullable: true })
  complainant!: string | null;

  @Column('varchar', { length: 20 })
  channel!: string; // web | email | regulator | phone

  @Column('varchar', { length: 30 })
  category!: string; // unfair_outcome | privacy | inaccuracy | no_explanation | other

  @Column('varchar', { length: 20 })
  severity!: string; // LOW | MEDIUM | HIGH

  @Index()
  @Column('varchar', { length: 20 })
  status!: string; // RECEIVED | ACKNOWLEDGED | INVESTIGATING | RESOLVED | REJECTED | CLOSED

  @Column('varchar', { length: 2000, nullable: true })
  resolutionNotes!: string | null;

  @Index()
  @Column('datetime')
  slaDueAt!: Date;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;

  @Column('datetime', { nullable: true })
  acknowledgedAt!: Date | null;

  @Column('datetime', { nullable: true })
  resolvedAt!: Date | null;

  /** The decision this grievance contests (governance E2.2). */
  @Index()
  @Column('varchar', { length: 255, nullable: true })
  decisionRef!: string | null;

  /** The rejected grievance this one appeals (governance E2.2). */
  @Column('varchar', { length: 36, nullable: true })
  appealOf!: string | null;
}
