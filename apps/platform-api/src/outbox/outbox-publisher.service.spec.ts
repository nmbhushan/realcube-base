import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { DataSource } from 'typeorm';
import { OutboxPublisherService } from './outbox-publisher.service';

type TestEvent = {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  tenant_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  attempt_count: number;
};

describe('OutboxPublisherService', () => {
  let dataSource: { query: jest.Mock };
  let service: OutboxPublisherService;
  let fakeSqs: { send: jest.Mock };

  const event: TestEvent = {
    event_id: 'evt-123',
    event_type: 'platform.project_access.revoked',
    aggregate_type: 'user_project_access',
    aggregate_id: 'tenant-1:user-1:FINANCE',
    tenant_id: 'tenant-1',
    payload: { tenantId: 'tenant-1', userId: 'user-1', projectCode: 'FINANCE', status: 'revoked' },
    occurred_at: '2026-10-29T00:00:00Z',
    attempt_count: 1,
  };

  const publisher = () => service as unknown as {
    queueUrl: string;
    sqs: SQSClient;
    publish: (message: TestEvent) => Promise<void>;
  };

  beforeEach(() => {
    dataSource = { query: jest.fn().mockResolvedValue([]) };
    service = new OutboxPublisherService(dataSource as unknown as DataSource);
    fakeSqs = { send: jest.fn().mockResolvedValue({ MessageId: 'sqs-message-1' }) };
    publisher().sqs = fakeSqs as unknown as SQSClient;
    publisher().queueUrl = 'https://sqs.ap-south-1.amazonaws.com/123456789012/access-events';
  });

  it('publishes the stable event ID and marks the outbox row published', async () => {
    await publisher().publish(event);
    expect(fakeSqs.send).toHaveBeenCalledTimes(1);
    const command = fakeSqs.send.mock.calls[0][0] as SendMessageCommand;
    expect(command).toBeInstanceOf(SendMessageCommand);
    expect(command.input.QueueUrl).toBe(publisher().queueUrl);
    const body = JSON.parse(command.input.MessageBody ?? '{}');
    expect(body).toMatchObject({
      eventId: 'evt-123',
      eventType: 'platform.project_access.revoked',
      aggregateId: 'tenant-1:user-1:FINANCE',
    });
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('SET published_at = now()'),
      ['evt-123'],
    );
  });

  it('releases a failed event for exponential retry and records the error', async () => {
    fakeSqs.send.mockRejectedValueOnce(new Error('temporary queue failure'));
    await publisher().publish(event);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('available_at = now()'),
      ['evt-123', 2, 'temporary queue failure'],
    );
  });
});
