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
        updated_at: Date | null;
      }>(
        `SELECT p.entitlement_status, p.entitlement_version, p.projected_at, s.updated_at
           FROM pims_entitlement_projection p
           LEFT JOIN pims_access_event_consumer_state s ON s.id = 1
          WHERE p.oidc_issuer = $1
            AND p.oidc_subject = $2
            AND p.tenant_id = $3
            AND p.project_code = 'PIMS'
          LIMIT 1`,
        [issuer, subject, tenantId],
      );
    } catch {
      // Never fall back to potentially stale token claims when the authorization projection is unavailable.
      throw new ServiceUnavailableException('Current PIMS entitlement could not be verified');
    }

    const row = result.rows[0];
    if (!row) return { active: false, version: null, projectedAt: null };

    if (!row.updated_at) throw new ServiceUnavailableException('PIMS entitlement consumer has not initialized');
    const projectedAt = new Date(row.projected_at);
    const heartbeatAgeMs = Date.now() - new Date(row.updated_at).getTime();
    if (!Number.isFinite(heartbeatAgeMs) || heartbeatAgeMs < -5000 || heartbeatAgeMs > maxProjectionAgeSeconds * 1000) {
      throw new ServiceUnavailableException('PIMS entitlement projection is stale');
    }

    return {
      active: row.entitlement_status === 'granted',
      version: row.entitlement_version,
      projectedAt,
    };
  }
}
