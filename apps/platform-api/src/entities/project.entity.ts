import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type ProjectStatus = 'active' | 'disabled';

@Entity({ name: 'projects' })
export class Project {
  @PrimaryColumn({ type: 'text' })
  code!: string;

  @Column()
  name!: string;

  @Column({ type: 'text', default: 'active' })
  status!: ProjectStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
