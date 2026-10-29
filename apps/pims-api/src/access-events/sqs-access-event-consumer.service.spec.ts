import { SqsAccessEventConsumerService } from './sqs-access-event-consumer.service';

describe('SqsAccessEventConsumerService event parsing', () => {
  const consumer = new SqsAccessEventConsumerService({} as any);
  const parse = (consumer as any).parseEvent.bind(consumer);

  const base = {
    eventId: '11111111-1111-4111-8111-111111111111',
    eventType: 'platform.project_access.revoked',
    aggregateType: 'user_project_access',
    aggregateId: 'tenant:user:PIMS',
    tenantId: '22222222-2222-4222-8222-222222222222',
    occurredAt: new Date().toISOString(),
  };

  it('accepts a well-formed PIMS revoke event', () => {
    expect(parse(JSON.stringify({
      ...base,
      payload: {
        tenantId: base.tenantId,
        userId: 'user-id',
        projectCode: 'PIMS',
        status: 'revoked',
        entitlementVersion: '2',
        oidcIssuer: 'https://issuer.example.test/',
        oidcSubject: 'subject-1',
      },
    }))).toMatchObject({ eventId: base.eventId, eventType: base.eventType });
  });

  it('ignores valid events for other projects', () => {
    expect(parse(JSON.stringify({
      ...base,
      payload: { tenantId: base.tenantId, projectCode: 'FINANCE', status: 'revoked' },
    }))).toBeNull();
  });

  it('ignores valid non-entitlement event families', () => {
    expect(parse(JSON.stringify({
      ...base,
      eventType: 'platform.tenant.created',
      payload: { tenantId: base.tenantId },
    }))).toBeNull();
  });

  it('rejects a PIMS event missing OIDC identity mapping', () => {
    expect(() => parse(JSON.stringify({
      ...base,
      payload: {
        tenantId: base.tenantId,
        projectCode: 'PIMS',
        status: 'revoked',
        entitlementVersion: '2',
      },
    }))).toThrow(/PIMS access event/);
  });

  it('rejects event status that disagrees with the event type', () => {
    expect(() => parse(JSON.stringify({
      ...base,
      payload: {
        tenantId: base.tenantId,
        projectCode: 'PIMS',
        status: 'granted',
        entitlementVersion: '3',
        oidcIssuer: 'https://issuer.example.test/',
        oidcSubject: 'subject-1',
      },
    }))).toThrow(/PIMS access event/);
  });
});
