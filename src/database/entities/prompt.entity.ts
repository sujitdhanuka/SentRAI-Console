import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** A prompt discovered in scanned source, attached to a model. */
@Entity({ name: 'prompts' })
export class PromptEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('text')
  rawText!: string;

  @Column('varchar', { length: 50 })
  promptType!: string;

  @Column('varchar', { length: 50, default: 'LOW' })
  injectionRisk!: string;

  @Column('simple-json')
  piiDetected!: string[];
}
