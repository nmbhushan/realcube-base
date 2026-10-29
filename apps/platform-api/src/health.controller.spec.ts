import { ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports readiness only when PostgreSQL responds', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as unknown as DataSource;
    const controller = new HealthController(dataSource);
    await expect(controller.readiness()).resolves.toMatchObject({
      status: 'ready',
      dependencies: { database: 'ok' },
    });
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns 503 when the database probe fails without leaking driver errors', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dataSource = { query: jest.fn().mockRejectedValue(new Error('password=do-not-log')) } as unknown as DataSource;
    const controller = new HealthController(dataSource);
    await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).not.toContain('password=do-not-log');
    warn.mockRestore();
  });
});
