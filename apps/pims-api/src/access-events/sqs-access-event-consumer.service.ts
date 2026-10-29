import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Pool } from 'pg';
import { Inject } from '@nestjs/common';
import { PIMS_POOL } from '../db/database.constants';

interface PlatformAccessEvent {
  eventId: string;
  eventType: string;
  tenantId: string | null;
  occurredAt: string;
  payload: {
    tenantId?: string;
    userId?: string;
    projectCode?: string;
    status?: 'granted' | 'revoked';
    entitlementVersion?: string | number;
    oidcIssuer?: string;
    oidcSubject?: string;
  };
}

@Injectable()
export class SqsAccessEventConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsAccessEventConsumerService.name);
  private client?: SQSClient;
  private timer?: NodeJS.Timeout;
  private stopping = false;
  private polling = false;
  private readonly queueUrl = process.env.PIMS_ACCESS_EVENTS_QUEUE_URL;

  constructor(@Inject(PIMS_POOL) private readonly pool: Pool) {}

  onModuleInit(): void {
    if (process.env.PIMS_ACCESS_EVENTS_CONSUMER_ENABLED !== 'true') return;
    if (!this.queueUrl) {
      this.logger.error('PIMS_ACCESS_EVENTS_CONSUMER_ENABLED is true but PIMS_ACCESS_EVENTS_QUEUE_URL is missing');
      return;
    }
    this.client = new SQSClient({ region: process.env.AWS_REGION || 'ap-south-1' });
    this.schedule(1000);
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.client?.destroy();
  }

  private schedule(delayMs: number): void {
    if (!this.stopping) this.timer = setTimeout(() => void this.poll(), delayMs);
  }

  private async poll(): Promise<void> {
    if (this.stopping || this.polling || !this.client || !this.queueUrl) return;
    this.polling = true;
    let delay = 5000;
    try {
      const response = await this.client.send(new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 10,
        VisibilityTimeout: 45,
        AttributeNames: ['ApproximateReceiveCount'],
      }));
      let allMessagesProcessed = true;
      for (const message of response.Messages ?? []) {
        try {
          await this.processMessage(message);
        } catch (error) {
          allMessagesProcessed = false;
          await this.pool.query('UPDATE pims_access_event_consumer_state SET healthy = false WHERE id = 1').catch(() => undefined);
          // Leave the message for SQS retry/DLQ policy. Do not log its body or identity claims.
          this.logger.warn(`Access event processing failed; message will be retried: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }
      if (allMessagesProcessed) {
        await this.pool.query('UPDATE pims_access_event_consumer_state SET updated_at = now() WHERE id = 1 AND healthy = true');
      }
      delay = 1000;
    } catch (error) {
      this.logger.error(`SQS receive failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      this.polling = false;
      this.schedule(delay);
    }
  }

  private async processMessage(message: Message): Promise<void> {
    if (!message.Body || !message.ReceiptHandle || !this.client || !this.queueUrl) {
      throw new Error('SQS message body or receipt handle is missing');
    }
    const event = this.parseEvent(message.Body);
    if (event) await this.applyEvent(event);
    await this.client.send(new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: message.ReceiptHandle,
    }));
  }

  private parseEvent(body: string): PlatformAccessEvent | null {
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw new Error('Invalid access event JSON'); }
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid access event');
    const event = parsed as Partial<PlatformAccessEvent>;
    if (
      typeof event.eventId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.eventId) ||
      typeof event.eventType !== 'string' ||
      typeof event.occurredAt !== 'string' ||
      !event.payload || typeof event.payload !== 'object'
    ) {
      throw new Error('Access event envelope is invalid');
    }

    // Platform publishes several event families and projects to the shared queue.
    // Valid but irrelevant events must be acknowledged rather than poison the PIMS consumer.
    if (!event.eventType.startsWith('platform.project_access.')) return null;
    const payload = event.payload;
    if (typeof payload.projectCode !== 'string') throw new Error('Project access event is missing projectCode');
    if (payload.projectCode !== 'PIMS') return null;

    if (
      typeof payload.tenantId !== 'string' ||
      typeof payload.oidcIssuer !== 'string' || !payload.oidcIssuer ||
      typeof payload.oidcSubject !== 'string' || !payload.oidcSubject ||
      (payload.status !== 'granted' && payload.status !== 'revoked') ||
      event.eventType !== (payload.status === 'granted' ? 'platform.project_access.granted' : 'platform.project_access.revoked') ||
      !/^\d+$/.test(String(payload.entitlementVersion))
    ) {
      throw new Error('PIMS access event does not match the entitlement contract');
    }
    const version = BigInt(String(payload.entitlementVersion));
    if (version < 1n) throw new Error('Invalid entitlement version');
    const date = new Date(event.occurredAt);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid event timestamp');
    return event as PlatformAccessEvent;
  }

  private async applyEvent(event: PlatformAccessEvent): Promise<void> {
    const payload = event.payload;
    const version = String(payload.entitlementVersion);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const duplicate = await client.query(
        'SELECT 1 FROM pims_processed_access_events WHERE event_id = $1',
        [event.eventId],
      );
      if (duplicate.rowCount) {
        await client.query('COMMIT');
        return;
      }

      await client.query(
        `INSERT INTO pims_entitlement_projection
           (oidc_issuer, oidc_subject, tenant_id, project_code, entitlement_status,
            entitlement_version, source_event_id, source_occurred_at, projected_at)
         VALUES ($1, $2, $3, 'PIMS', $4, $5, $6, $7, now())
         ON CONFLICT (oidc_issuer, oidc_subject, tenant_id, project_code)
         DO UPDATE SET entitlement_status = EXCLUDED.entitlement_status,
                       entitlement_version = EXCLUDED.entitlement_version,
                       source_event_id = EXCLUDED.source_event_id,
                       source_occurred_at = EXCLUDED.source_occurred_at,
                       projected_at = now()
         WHERE pims_entitlement_projection.entitlement_version < EXCLUDED.entitlement_version`,
        [payload.oidcIssuer, payload.oidcSubject, payload.tenantId, payload.status, version, event.eventId, event.occurredAt],
      );
      await client.query(
        'INSERT INTO pims_processed_access_events (event_id, event_type) VALUES ($1, $2)',
        [event.eventId, event.eventType],
      );
      await client.query(
        'UPDATE pims_access_event_consumer_state SET last_success_at = now(), last_event_id = $1 WHERE id = 1',
        [event.eventId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
