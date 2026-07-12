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
    const masked = maskDict(body);
    try {
      if (JSON.stringify(masked).length > MAX_PAYLOAD_CHARS) {
        return { truncated: true, keys: Object.keys(masked) };
      }
    } catch {
      return { unserializable: true };
    }
    return masked;
  }

  private record(req: any, statusCode: number, outcome: 'SUCCESS' | 'FAILURE'): void {
    const actor = req.user?.email ?? (typeof req.body?.email === 'string' ? `unauthenticated:${req.body.email}` : 'anonymous');
    // Fire-and-forget: audit persistence must never break the request path,
    // but failures are loudly logged.
    this.events
      .save(this.events.create({
        id: uuidv4(),
        actor: String(actor).slice(0, 255),
        actorRole: req.user?.role ?? '',
        method: req.method,
        path: String(req.originalUrl ?? req.url ?? '').slice(0, 512),
        statusCode,
        outcome,
        payloadSummary: this.summarize(req.body),
        occurredAt: new Date(),
      }))
      .catch((e) => this.logger.error(`failed to persist audit event: ${String(e)}`));
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
