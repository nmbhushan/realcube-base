import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type MembershipStatus = 'active' | 'suspended' | 'removed';

@Entity({ name: 'tenant_users' })
export class TenantMembership {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'text', default: 'active' })
  status!: MembershipStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
