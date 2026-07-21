import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * An organization's customized prompt template — one row per saved VERSION,
 * append-only (a row's body is never edited; saving writes version N+1).
 *
 * System defaults are NOT rows: they live in code (src/ai/default-prompts.ts)
 * and resolution is "the org's active row, else the code default". That way
 * upgrades can improve default prompts without touching customized orgs, and
 * "reset to default" merely deactivates the org's rows.
 */
@Entity({ name: 'prompt_templates' })
export class PromptTemplateEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  tenantId!: string;

  /** Which generation task this prompt drives: 'model_summary', … */
  @Index()
  @Column('varchar', { length: 50 })
  useCase!: string;

  /** 1-based, monotonically increasing per (tenantId, useCase). */
  @Column('int')
  version!: number;

  /** The template text with {{variable}} placeholders. Immutable once saved. */
  @Column('text')
  body!: string;

  /** At most one active row per (tenantId, useCase); none = default applies. */
  @Column('boolean', { default: false })
  active!: boolean;

  /** Optional operator note: why this version was saved ("added PII rule"). */
  @Column('varchar', { length: 255, nullable: true })
  changeNote!: string | null;

  @Column('varchar', { length: 255 })
  createdBy!: string;

  @Column('datetime')
  createdAt!: Date;
}
