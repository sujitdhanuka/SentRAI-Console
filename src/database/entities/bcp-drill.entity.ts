import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A business-continuity drill conducted for a model (RBI FREE-AI Rec 21,
 * plan epic E0.4). Recording a drill also sets bcp_states.drillLastConducted,
 * which the Sutra 7 check reads when the GOV_E0_4_BCP_DRILLS flag is on.
 */
@Entity({ name: 'bcp_drills' })
export class BcpDrillEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Column('datetime')
  conductedAt!: Date;

  /** What was simulated, e.g. "Model endpoint outage; fall back to rules engine". */
  @Column('varchar', { length: 500 })
  scenario!: string;

  /** PASSED | PASSED_WITH_FINDINGS | FAILED */
  @Column('varchar', { length: 30 })
  result!: string;

  @Column('text', { nullable: true })
  findings!: string | null;

  @Column('varchar', { length: 255 })
  conductedBy!: string;

  @Column('datetime')
  recordedAt!: Date;
}
