import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'node:crypto';

import { AuditEventEntity } from '../database/entities';
import { maskDict } from '../common/dpdp';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_PAYLOAD_CHARS = 4000;

/**
 * Global audit interceptor: every mutating API request — successful or not —
 * produces one audit_events row with the actor, route, outcome, and a
 * PII-masked payload summary. This is what makes "every action audit-logged"
 * literally true across users, orgs, projects, compliance, monitoring & auth.
 */
@Injectable()
export class AuditEventsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditEventsInterceptor.name);

  constructor(
    @InjectRepository(AuditEventEntity) private readonly events: Repository<AuditEventEntity>,
  ) {}

  private summarize(body: any): Record<string, any> | null {
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) return null;
    // Size-check the RAW body first — masking a large payload (e.g. a CI
    // repository snapshot) just to discard it wastes CPU and memory.
    try {
      if (JSON.stringify(body).length > MAX_PAYLOAD_CHARS) {
        return { truncated: true, keys: Object.keys(body) };
      }
    } catch {
      return { unserializable: true };
    }
    return maskDict(body);
  }

  /** Serializes chained writes so two concurrent requests can't fork the chain. */
  private chainTail: Promise<void> = Promise.resolve();

  /** Canonical content string an auditor can recompute offline. */
  static canonical(e: {
    id: string; actor: string; actorRole: string; method: string; path: string;
    statusCode: number; outcome: string; payloadSummary: Record<string, any> | null; occurredAt: Date;
  }): string {
    return JSON.stringify({
      id: e.id, actor: e.actor, actor_role: e.actorRole, method: e.method, path: e.path,
      status_code: e.statusCode, outcome: e.outcome, payload_summary: e.payloadSummary,
      occurred_at: e.occurredAt.toISOString(),
    });
  }

  static hash(canonical: string, prevHash: string): string {
    return createHash('sha256').update(`${canonical}|${prevHash}`).digest('hex');
  }

  private record(req: any, statusCode: number, outcome: 'SUCCESS' | 'FAILURE'): void {
    const actor = req.user?.email ?? (typeof req.body?.email === 'string' ? `unauthenticated:${req.body.email}` : 'anonymous');
    const row = {
      id: uuidv4(),
      actor: String(actor).slice(0, 255),
      actorRole: req.user?.role ?? '',
      method: req.method,
      path: String(req.originalUrl ?? req.url ?? '').slice(0, 512),
      statusCode,
      outcome,
      payloadSummary: this.summarize(req.body),
      occurredAt: new Date(),
    };
    // Fire-and-forget for the REQUEST path, but chained writes are serialized
    // among themselves: each links to the previous event's hash, making the
    // ledger tamper-evident (see GET /audit/events/verify). Failures are
    // loudly logged and never break the request.
    this.chainTail = this.chainTail.then(async () => {
      try {
        const last = await this.events.find({
          where: {}, order: { occurredAt: 'DESC', id: 'DESC' }, take: 1,
        });
        const prevHash = last[0]?.contentHash ?? 'GENESIS';
        const contentHash = AuditEventsInterceptor.hash(AuditEventsInterceptor.canonical(row), prevHash);
        await this.events.save(this.events.create({ ...row, prevHash, contentHash }));
      } catch (e) {
        this.logger.error(`failed to persist audit event: ${String(e)}`);
      }
    });
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    if (!MUTATING_METHODS.has(req.method)) return next.handle();

    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse();
        this.record(req, res.statusCode ?? 200, 'SUCCESS');
      }),
      catchError((err) => {
        const status = err instanceof HttpException ? err.getStatus() : 500;
        this.record(req, status, 'FAILURE');
        return throwError(() => err);
      }),
    );
  }
}
