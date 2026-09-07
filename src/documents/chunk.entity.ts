import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('chunks')
export class Chunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  documentId: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  workspaceId: string | null;

  @Column({ type: 'int' })
  chunkIndex: number;

  @Column({ type: 'text' })
  content: string;

  @Column({
    type: 'tsvector',
    select: false,
    nullable: true,
    insert: false,
    update: false,
  })
  tsv: string;

  @CreateDateColumn()
  createdAt: Date;
}
