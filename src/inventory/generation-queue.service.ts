import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AIModelEntity } from '../database/entities';
import { CurrentUser } from '../common/interfaces/current-user.interface';

/** The per-model generations that can be auto-populated after a scan. */
export type GenerationKind = 'summary' | 'risk_rationale' | 'gap_remediation';

const ALL_KINDS: GenerationKind[] = ['summary', 'risk_rationale', 'gap_remediation'];

interface QueueItem {
  modelId: string;
  kinds: GenerationKind[];
  user: CurrentUser;
}

export interface GenerationStatus {
  running: boolean;
  queued: number;
  in_flight: string | null;
  completed: number;
  failed: number;
  /** Per-model outcome of the current/most recent run, newest last. */
  recent: Array<{ model_id: string; kind: GenerationKind; status: 'ok' | 'failed'; detail?: string }>;
  started_at: string | null;
  finished_at: string | null;
}

/**
 * Populates the AI generations for freshly discovered models without making the
 * caller wait. A scan can produce dozens of models and each one needs three
 * generations, so doing this inline would hold the import request open for
 * minutes against a remote LLM.
 *
 * The queue is deliberately serial: the summarizer already enforces a per-org
 * rate limit and circuit breaker, and processing one model at a time keeps us
 * comfortably inside both rather than racing against them. Work is skipped when
 * a generation already exists, so a re-scan only fills the gaps — re-running it
 * is cheap and never burns tokens on content that is already there.
 */
@Injectable()
export class GenerationQueueService {
  private readonly log = new Logger('GenerationQueue');
  private readonly queue: QueueItem[] = [];
  private draining = false;

  private state: GenerationStatus = {
    running: false, queued: 0, in_flight: null, completed: 0, failed: 0,
    recent: [], started_at: null, finished_at: null,
  };

  /** Set by InventoryModule to avoid a circular provider dependency. */
  private runner: ((user: CurrentUser, modelId: string, kind: GenerationKind) => Promise<void>) | null = null;

  constructor(
    @InjectRepository(AIModelEntity) private readonly models: Repository<AIModelEntity>,
  ) {}

  setRunner(fn: (user: CurrentUser, modelId: string, kind: GenerationKind) => Promise<void>): void {
    this.runner = fn;
  }

  /** Which generations this model is still missing. */
  private missing(orm: AIModelEntity): GenerationKind[] {
    const out: GenerationKind[] = [];
    // A description that is only a docstring or the scanner's auto-text still
    // counts as ungenerated — 'static' means nothing has summarised it yet.
    if (!orm.descriptionSource || orm.descriptionSource === 'static') out.push('summary');
    if (!orm.riskRationale) out.push('risk_rationale');
    if (!orm.gapRemediation) out.push('gap_remediation');
    return out;
  }

  /**
   * Queue the missing generations for these models. Returns how many units of
   * work were enqueued so the caller can tell the user what to expect.
   */
  async enqueueMissing(user: CurrentUser, modelIds: string[], force = false): Promise<number> {
    let queued = 0;
    for (const modelId of modelIds) {
      const orm = await this.models.findOne({ where: { id: modelId } });
      if (!orm) continue;
      const kinds = force ? ALL_KINDS : this.missing(orm);
      if (!kinds.length) continue;
      this.queue.push({ modelId, kinds, user });
      queued += kinds.length;
    }
    this.state.queued += queued;
    if (queued) void this.drain();
    return queued;
  }

  status(): GenerationStatus {
    return { ...this.state, queued: this.state.queued, recent: this.state.recent.slice(-20) };
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    this.state.running = true;
    this.state.started_at = this.state.started_at ?? new Date().toISOString();
    this.state.finished_at = null;

    try {
      while (this.queue.length) {
        const item = this.queue.shift()!;
        for (const kind of item.kinds) {
          this.state.in_flight = `${item.modelId}:${kind}`;
          try {
            if (!this.runner) throw new Error('generation runner not wired');
            await this.runner(item.user, item.modelId, kind);
            this.state.completed += 1;
            this.state.recent.push({ model_id: item.modelId, kind, status: 'ok' });
          } catch (e) {
            // One model failing must never stall the rest of the batch; the
            // failure is recorded and the queue moves on.
            this.state.failed += 1;
            const detail = e instanceof Error ? e.message : String(e);
            this.state.recent.push({ model_id: item.modelId, kind, status: 'failed', detail });
            this.log.warn(`auto-generation failed for ${item.modelId} (${kind}): ${detail}`);
          } finally {
            this.state.queued = Math.max(0, this.state.queued - 1);
          }
        }
      }
    } finally {
      this.draining = false;
      this.state.running = false;
      this.state.in_flight = null;
      this.state.finished_at = new Date().toISOString();
    }
  }
}
