import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { PIMS_POOL } from '../db/database.constants';

export interface CurrentEntitlement {
  active: boolean;
  version: string | null;
  projectedAt: Date | null;
}

@Injectable()
export class EntitlementService {
  constructor(@Inject(PIMS_POOL) private readonly pool: Pool) {}

  async getCurrentEntitlement(issuer: string, subject: string, tenantId: string): Promise<CurrentEntitlement> {
    const maxProjectionAgeSeconds = Number(process.env.PIMS_ENTITLEMENT_MAX_AGE_SECONDS ?? '60');
    if (!Number.isInteger(maxProjectionAgeSeconds) || maxProjectionAgeSeconds < 1 || maxProjectionAgeSeconds > 3600) {
      throw new ServiceUnavailableException('PIMS entitlement freshness policy is invalid');
    }

    let result;
    try {
      result = await this.pool.query<{
        entitlement_status: string;
        entitlement_version: string;
        projected_at: Date;
      }>(
        `SELECT entitlement_status, entitlement_version, projected_at
           FROM pims_entitlement_projection
          WHERE oidc_issuer = $1
            AND oidc_subject = $2
            AND tenant_id = $3
            AND project_code = 'PIMS'
          LIMIT 1`,
        [issuer, subject, tenantId],
      );
    } catch {
      // Never fall back to potentially stale token claims when the authorization projection is unavailable.
      throw new ServiceUnavailableException('Current PIMS entitlement could not be verified');
    }

    const row = result.rows[0];
    if (!row) return { active: false, version: null, projectedAt: null };

    const projectedAt = new Date(row.projected_at);
    const ageMs = Date.now() - projectedAt.getTime();
    if (!Number.isFinite(ageMs) || ageMs < -5000 || ageMs > maxProjectionAgeSeconds * 1000) {
      throw new ServiceUnavailableException('PIMS entitlement projection is stale');
    }

    return {
      active: row.entitlement_status === 'granted',
      version: row.entitlement_version,
      projectedAt,
    };
  }
}
