import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

interface ClaimedOutboxEvent {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  tenant_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: Date | string;
  attempt_count: number;
}

@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private timer?: NodeJS.Timeout;
  private sqs?: SQSClient;
  private stopping = false;
  private readonly queueUrl = process.env.ACCESS_EVENTS_QUEUE_URL;

  constructor(private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    // API pods do not publish unless explicitly enabled. A dedicated worker deployment is preferred at scale.
    if (process.env.OUTBOX_PUBLISHER_ENABLED !== 'true') return;
    if (!this.queueUrl) {
      this.logger.error('OUTBOX_PUBLISHER_ENABLED is true but ACCESS_EVENTS_QUEUE_URL is missing');
      return;
    }
    this.sqs = new SQSClient({ region: process.env.AWS_REGION || 'ap-south-1' });
    this.schedule(1000);
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.sqs?.destroy();
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => void this.poll(), delayMs);
  }

  private async poll(): Promise<void> {
    try {
      const events = await this.claimBatch();
      for (const event of events) await this.publish(event);
    } catch (error) {
      this.logger.error('Outbox poll failed', error instanceof Error ? error.stack : String(error));
    } finally {
      const configuredInterval = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 5000);
      this.schedule(Number.isFinite(configuredInterval) ? Math.max(1000, configuredInterval) : 5000);
    }
  }

  private async claimBatch(): Promise<ClaimedOutboxEvent[]> {
    // Single atomic statement claims events across multiple replicas using SKIP LOCKED.
    return this.dataSource.query(
      `WITH claimable AS (
         SELECT event_id
           FROM access_change_outbox
          WHERE published_at IS NULL
            AND available_at <= now()
            AND (claimed_until IS NULL OR claimed_until < now())
          ORDER BY occurred_at
          LIMIT 25
          FOR UPDATE SKIP LOCKED
       )
       UPDATE access_change_outbox e
          SET claimed_until = now() + interval '60 seconds',
              attempt_count = e.attempt_count + 1
         FROM claimable c
        WHERE e.event_id = c.event_id
       RETURNING e.event_id, e.event_type, e.aggregate_type, e.aggregate_id,
                 e.tenant_id, e.payload, e.occurred_at, e.attempt_count`,
    );
  }

  private async publish(event: ClaimedOutboxEvent): Promise<void> {
    if (!this.sqs || !this.queueUrl) return;
    const message = {
      eventId: event.event_id,
      eventType: event.event_type,
      aggregateType: event.aggregate_type,
      aggregateId: event.aggregate_id,
      tenantId: event.tenant_id,
      payload: event.payload,
      occurredAt: event.occurred_at,
    };
    try {
      const fifo = this.queueUrl.endsWith('.fifo');
      await this.sqs.send(new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        ...(fifo ? {
          MessageGroupId: event.aggregate_id || 'enterprise-workspace',
          MessageDeduplicationId: event.event_id,
        } : {}),
      }));
      await this.dataSource.query(
        `UPDATE access_change_outbox
            SET published_at = now(), claimed_until = NULL, last_error = NULL
          WHERE event_id = $1 AND published_at IS NULL`,
        [event.event_id],
      );
    } catch (error) {
      const messageText = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      const retrySeconds = Math.min(300, 2 ** Math.min(event.attempt_count, 8));
      await this.dataSource.query(
        `UPDATE access_change_outbox
            SET claimed_until = NULL,
                available_at = now() + ($2 * interval '1 second'),
                last_error = $3
          WHERE event_id = $1 AND published_at IS NULL`,
        [event.event_id, retrySeconds, messageText],
      );
      this.logger.warn(`Outbox event ${event.event_id} publish failed; retry in ${retrySeconds}s: ${messageText}`);
    }
  }
}
