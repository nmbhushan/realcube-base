import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type EntitlementStatus = 'granted' | 'revoked';

@Entity({ name: 'user_project_access' })
export class UserProjectAccess {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @PrimaryColumn({ name: 'project_code', type: 'text' })
  projectCode!: string;

  @Column({ type: 'text', default: 'granted' })
  status!: EntitlementStatus;

  @Column({ name: 'entitlement_version', type: 'bigint', default: 1 })
  entitlementVersion!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
