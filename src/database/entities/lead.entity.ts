import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A sales lead from the public landing page: either a contact message or a
 * booked product demo. Platform-level (no tenant): only a global ADMIN sees
 * them, in the console's Leads page.
 */
@Entity({ name: 'leads' })
export class LeadEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 10 })
  kind!: string; // contact | demo

  @Column('varchar', { length: 120 })
  name!: string;

  @Column('varchar', { length: 255 })
  email!: string;

  @Column('varchar', { length: 160, nullable: true })
  company!: string | null;

  @Column('varchar', { length: 120, nullable: true })
  jobRole!: string | null;

  @Column('varchar', { length: 40, nullable: true })
  topic!: string | null;

  @Column('text', { nullable: true })
  message!: string | null;

  /** Demo start, UTC. Null for contact messages. */
  @Index()
  @Column('datetime', { nullable: true })
  slotStart!: Date | null;

  @Column('int', { nullable: true })
  slotMinutes!: number | null;

  /** The visitor's IANA time zone, so the admin can see their local time. */
  @Column('varchar', { length: 64, nullable: true })
  visitorTimezone!: string | null;

  @Index()
  @Column('varchar', { length: 20 })
  status!: string; // NEW | CONFIRMED | CONTACTED | DONE | CANCELLED

  @Column('varchar', { length: 2000, nullable: true })
  adminNotes!: string | null;

  @Column('varchar', { length: 255, nullable: true })
  handledBy!: string | null;

  @Column('datetime')
  createdAt!: Date;

  @Column('datetime')
  updatedAt!: Date;
}
