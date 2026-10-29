import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PIMS_POOL } from '../db/database.constants';
import { PimsPrincipal } from '../auth/pims-auth';
import { CreateWorkItemDto } from './create-work-item.dto';

@Injectable()
export class WorkItemsService {
  constructor(@Inject(PIMS_POOL) private readonly pool: Pool) {}

  async list(principal: PimsPrincipal) {
    return this.withTenantContext(principal.tenantId, async (client) => {
      const result = await client.query(
        `SELECT id, title, description, status, created_at AS "createdAt", updated_at AS "updatedAt"
           FROM pims_work_items
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT 100`,
        [principal.tenantId],
      );
      return result.rows;
    });
  }

  async create(principal: PimsPrincipal, input: CreateWorkItemDto) {
    return this.withTenantContext(principal.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO pims_work_items
           (tenant_id, title, description, created_by_issuer, created_by_subject)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, title, description, status, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          principal.tenantId,
          input.title.trim(),
          input.description?.trim() || null,
          principal.issuer,
          principal.subject,
        ],
      );
      return result.rows[0];
    });
  }

  private async withTenantContext<T>(
    tenantId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
