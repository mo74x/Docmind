import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('workspaces')
export class Workspace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, unique: true })
  slug: string;

  @Column({ type: 'varchar', length: 255 })
  apiKeyHash?: string;

  @Index()
  @Column({ type: 'varchar', length: 32 })
  apiKeyPrefix: string;

  @CreateDateColumn()
  createdAt: Date;

  /**
   * Only populated in memory immediately after workspace creation.
   * Not persisted in database.
   */
  apiKey?: string;
}
