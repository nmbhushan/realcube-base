import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type PlatformAdminGrantStatus = 'active' | 'revoked';

@Entity({ name: 'platform_admin_grants' })
@Index('uq_platform_admin_grants_active', ['userId', 'permissionCode'], {
  unique: true,
  where: '"status" = \'active\'',
})
export class PlatformAdminGrant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'permission_code', type: 'text', default: 'platform:admin' })
  permissionCode!: string;

  @Column({ type: 'text' })
  status!: PlatformAdminGrantStatus;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ name: 'granted_by_user_id', type: 'uuid', nullable: true })
  grantedByUserId!: string | null;

  @CreateDateColumn({ name: 'granted_at', type: 'timestamptz' })
  grantedAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
