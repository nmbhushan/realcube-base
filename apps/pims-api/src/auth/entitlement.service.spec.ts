import { ServiceUnavailableException } from '@nestjs/common';
import { EntitlementService } from './entitlement.service';

describe('EntitlementService', () => {
  const prior = process.env.PIMS_ENTITLEMENT_MAX_AGE_SECONDS;
  const client = { query: jest.fn(), release: jest.fn() };
  const pool = { connect: jest.fn() };
  const service = new EntitlementService(pool as any);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PIMS_ENTITLEMENT_MAX_AGE_SECONDS = '60';
    pool.connect.mockResolvedValue(client);
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT p.entitlement_status')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
  });

  afterAll(() => {
    if (prior === undefined) delete process.env.PIMS_ENTITLEMENT_MAX_AGE_SECONDS;
    else process.env.PIMS_ENTITLEMENT_MAX_AGE_SECONDS = prior;
  });

  it('requires a current projection and active consumer heartbeat', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT p.entitlement_status')) return { rows: [{
        entitlement_status: 'granted',
        entitlement_version: '7',
        projected_at: new Date(),
        updated_at: new Date(),
        healthy: true,
        membership_status: 'active',
      }] };
      return { rows: [], rowCount: 0 };
    });
    await expect(service.getCurrentEntitlement('https://issuer.test', 'subject-a', '11111111-1111-4111-8111-111111111111'))
      .resolves.toMatchObject({ active: true, version: '7' });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('pims_entitlement_projection'), [
      'https://issuer.test', 'subject-a', '11111111-1111-4111-8111-111111111111',
    ]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("set_config('app.tenant_id'"), [
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(client.release).toHaveBeenCalled();
  });

  it('reports a revoked projection as inactive', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT p.entitlement_status')) return { rows: [{
        entitlement_status: 'revoked',
        entitlement_version: '8',
        projected_at: new Date(),
        updated_at: new Date(),
        healthy: true,
        membership_status: 'active',
      }] };
      return { rows: [], rowCount: 0 };
    });
    await expect(service.getCurrentEntitlement('issuer', 'subject', '11111111-1111-4111-8111-111111111111'))
      .resolves.toMatchObject({ active: false, version: '8' });
  });

  it('fails closed when the consumer heartbeat is stale', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT p.entitlement_status')) return { rows: [{
        entitlement_status: 'granted',
        entitlement_version: '7',
        projected_at: new Date(),
        updated_at: new Date(Date.now() - 120_000),
        healthy: true,
        membership_status: 'active',
      }] };
      return { rows: [], rowCount: 0 };
    });
    await expect(service.getCurrentEntitlement('issuer', 'subject', '11111111-1111-4111-8111-111111111111'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails closed when an event-processing failure marks the consumer unhealthy', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT p.entitlement_status')) return { rows: [{
        entitlement_status: 'granted',
        entitlement_version: '7',
        projected_at: new Date(),
        updated_at: new Date(),
        healthy: false,
        membership_status: 'active',
      }] };
      return { rows: [], rowCount: 0 };
    });
    await expect(service.getCurrentEntitlement('issuer', 'subject', '11111111-1111-4111-8111-111111111111'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails closed when the projection store is unavailable', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT p.entitlement_status')) throw new Error('database unavailable');
      return { rows: [], rowCount: 0 };
    });
    await expect(service.getCurrentEntitlement('issuer', 'subject', '11111111-1111-4111-8111-111111111111'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(client.release).toHaveBeenCalled();
  });
});
