import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { maskDict } from './dpdp';

/**
 * Outbound webhook notifier for governance events: circuit-breaker trips,
 * overdue incident reports, stale inventory entries, plan soft-limit
 * breaches, and discovery findings. Configure with WEBHOOK_URL; when unset,
 * events are logged so nothing is silently dropped.
 */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);
  private readonly webhookUrl: string | null;

  constructor(config: ConfigService) {
    this.webhookUrl = config.get<string | null>('webhookUrl') ?? null;
  }

  async notify(event: string, data: Record<string, any>): Promise<void> {
    const payload = { event, data: maskDict(data), sent_at: new Date().toISOString() };
    if (!this.webhookUrl) {
      this.logger.log(`notification (no WEBHOOK_URL configured) ${event}: ${JSON.stringify(payload.data)}`);
      return;
    }
    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) this.logger.warn(`webhook delivery failed: ${res.status} for event ${event}`);
    } catch (e) {
      this.logger.warn(`webhook delivery error for event ${event}: ${String(e)}`);
    }
  }
}
