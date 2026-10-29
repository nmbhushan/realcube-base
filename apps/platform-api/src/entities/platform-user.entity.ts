import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type PlatformUserStatus = 'invited' | 'active' | 'suspended' | 'deactivated';

@Entity({ name: 'users' })
@Index('uq_users_oidc_identity', ['oidcIssuer', 'oidcSubject'], { unique: true })
export class PlatformUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'oidc_issuer', type: 'text' })
  oidcIssuer!: string;

  @Column({ name: 'oidc_subject', type: 'text' })
  oidcSubject!: string;

  @Column({ type: 'text', nullable: true })
  email!: string | null;

  @Column({ name: 'display_name', type: 'text', nullable: true })
  displayName!: string | null;

  @Column({ type: 'text', default: 'invited' })
  status!: PlatformUserStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
