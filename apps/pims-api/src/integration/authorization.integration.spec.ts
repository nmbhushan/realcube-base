import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { EntitlementService } from '../auth/entitlement.service';
import { SqsAccessEventConsumerService } from '../access-events/sqs-access-event-consumer.service';
import { WorkItemsService } from '../work-items/work-items.service';
import type { PimsPrincipal } from '../auth/pims-auth';

const databaseUrl = process.env.PIMS_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('PIMS PostgreSQL authorization integration', () => {
  let pool: Pool;
  let workItems: WorkItemsService;
  let entitlements: EntitlementService;
  let consumer: SqsAccessEventConsumerService;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    workItems = new WorkItemsService(pool);
    entitlements = new EntitlementService(pool);
    consumer = new SqsAccessEventConsumerService(pool);
    await pool.query(
      'UPDATE pims_access_event_consumer_state SET healthy = true, updated_at = now() WHERE id = 1',
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('isolates work-item reads and rejects cross-tenant inserts at PostgreSQL RLS', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const principalA: PimsPrincipal = {
      issuer: 'https://issuer.integration.test/',
      subject: randomUUID(),
      tenantId: tenantA,
      projectAccess: ['PIMS'],
      permissions: ['pims:read', 'pims:write'],
    };
    const principalB: PimsPrincipal = {
      ...principalA,
      subject: randomUUID(),
      tenantId: tenantB,
    };

    await workItems.create(principalA, { title: 'tenant-a-secret' } as any);
    await workItems.create(principalB, { title: 'tenant-b-secret' } as any);

    const visibleToA = await workItems.list(principalA);
    expect(visibleToA.map((item: { title: string }) => item.title)).toContain('tenant-a-secret');
    expect(visibleToA.map((item: { title: string }) => item.title)).not.toContain('tenant-b-secret');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await expect(client.query(
        `INSERT INTO pims_work_items
           (tenant_id, title, created_by_issuer, created_by_subject)
         VALUES ($1, $2, $3, $4)`,
        [tenantB, 'forbidden-cross-tenant-write', principalA.issuer, principalA.subject],
      )).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('enforces grant, revoke and out-of-order event versions against the live projection', async () => {
    const tenantId = randomUUID();
    const issuer = 'https://issuer.integration.test/';
    const subject = randomUUID();
    const occurredAt = new Date().toISOString();
    await (consumer as any).applyEvent({
      eventId: randomUUID(),
      eventType: 'platform.tenant_membership.activated',
      tenantId,
      occurredAt,
      payload: { tenantId, userId: randomUUID(), status: 'active', membershipVersion: '1',
        oidcIssuer: issuer, oidcSubject: subject },
    });
    const apply = (status: 'granted' | 'revoked', version: string, eventId: string) =>
      (consumer as any).applyEvent({
        eventId,
        eventType: status === 'granted' ? 'platform.project_access.granted' : 'platform.project_access.revoked',
        aggregateType: 'user_project_access',
        aggregateId: `${tenantId}:user:PIMS`,
        tenantId,
        occurredAt,
        payload: {
          tenantId,
          userId: randomUUID(),
          projectCode: 'PIMS',
          status,
          entitlementVersion: version,
          oidcIssuer: issuer,
          oidcSubject: subject,
        },
      });

    await apply('granted', '1', randomUUID());
    await expect(entitlements.getCurrentEntitlement(issuer, subject, tenantId))
      .resolves.toMatchObject({ active: true, version: '1' });

    await apply('revoked', '2', randomUUID());
    await expect(entitlements.getCurrentEntitlement(issuer, subject, tenantId))
      .resolves.toMatchObject({ active: false, version: '2' });

    // Delayed old grant must never overwrite the newer revocation.
    await apply('granted', '1', randomUUID());
    await expect(entitlements.getCurrentEntitlement(issuer, subject, tenantId))
      .resolves.toMatchObject({ active: false, version: '2' });
  });
});
