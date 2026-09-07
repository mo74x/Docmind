/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ChatSession } from './chat-session.entity';
import { AnswerSource } from '../../query/answer.service';

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => ChatSession, (session) => session.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sessionId' })
  session: ChatSession;

  @Column({ type: 'varchar', length: 32, default: 'user' })
  role: 'user' | 'assistant' | 'system';

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'jsonb', nullable: true })
  sources: AnswerSource[] | null;

  @CreateDateColumn()
  createdAt: Date;
}
