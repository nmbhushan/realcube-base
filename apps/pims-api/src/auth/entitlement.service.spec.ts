import { ServiceUnavailableException } from '@nestjs/common';
import { EntitlementService } from './entitlement.service';

describe('EntitlementService', () => {
  const prior = process.env.PIMS_ENTITLEMENT_MAX_AGE_SECONDS;
  const pool = { query: jest.fn() };
  const service = new EntitlementService(pool as any);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PIMS_ENTITLEMENT_MAX_AGE_SECONDS = '60';
  });

  afterAll(() => {
    if (prior === undefined) delete process.env.PIMS_ENTITLEMENT_MAX_AGE_SECONDS;
    else process.env.PIMS_ENTITLEMENT_MAX_AGE_SECONDS = prior;
  });

  it('requires a current projection and active consumer heartbeat', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{
      entitlement_status: 'granted',
      entitlement_version: '7',
      projected_at: new Date(),
      updated_at: new Date(),
      healthy: true,
    }] });
    await expect(service.getCurrentEntitlement('https://issuer.test', 'subject-a', '11111111-1111-4111-8111-111111111111'))
      .resolves.toMatchObject({ active: true, version: '7' });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('pims_entitlement_projection'), [
      'https://issuer.test', 'subject-a', '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('reports a revoked projection as inactive', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{
      entitlement_status: 'revoked',
      entitlement_version: '8',
      projected_at: new Date(),
      updated_at: new Date(),
      healthy: true,
    }] });
    await expect(service.getCurrentEntitlement('issuer', 'subject', '11111111-1111-4111-8111-111111111111'))
      .resolves.toMatchObject({ active: false, version: '8' });
  });

  it('fails closed when the consumer heartbeat is stale', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{
      entitlement_status: 'granted',
      entitlement_version: '7',
      projected_at: new Date(),
      updated_at: new Date(Date.now() - 120_000),
      healthy: true,
    }] });
    await expect(service.getCurrentEntitlement('issuer', 'subject', '11111111-1111-4111-8111-111111111111'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails closed when the projection store is unavailable', async () => {
    pool.query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.getCurrentEntitlement('issuer', 'subject', '11111111-1111-4111-8111-111111111111'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
