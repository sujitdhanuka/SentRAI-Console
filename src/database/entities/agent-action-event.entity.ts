import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * A runtime action event emitted by a deployed AI system (Roadmap Pillar 3 —
 * Visibility). Where the model ledger records governance *state* changes, this
 * records what an agent actually *did* at runtime — a tool call, a decision, a
 * hand-off to another agent — tagged with its registry model id (the
 * SENTRAI_MODEL_ID stamped into the build). Ingested via the telemetry endpoint;
 * a tool_call whose tool falls outside the model's permitted set is flagged on
 * arrival, connecting static tool authorization (Pillar 2) to runtime.
 */
@Entity({ name: 'agent_action_events' })
export class AgentActionEventEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id!: string;

  @Index()
  @Column('varchar', { length: 36 })
  modelId!: string;

  @Index()
  @Column('varchar', { length: 36, nullable: true })
  tenantId!: string | null;

  /** Groups the events of a single agent run/conversation. */
  @Index()
  @Column('varchar', { length: 64, nullable: true })
  sessionId!: string | null;

  @Column('varchar', { length: 30 })
  eventType!: string; // tool_call | decision | handoff | output | error

  /** For tool_call events, the tool/capability id invoked (e.g. capability:shell). */
  @Column('varchar', { length: 160, nullable: true })
  tool!: string | null;

  @Column('varchar', { length: 30 })
  outcome!: string; // success | blocked | error | unauthorized_tool

  /** True when this event is a tool call outside the model's permitted set. */
  @Index()
  @Column('boolean', { default: false })
  flagged!: boolean;

  /** Compact, PII-masked context (summary, target, latency, …). */
  @Column('simple-json', { nullable: true })
  detail!: Record<string, any> | null;

  @Column('varchar', { length: 255 })
  actor!: string;

  @Index()
  @Column('datetime')
  occurredAt!: Date;
}
