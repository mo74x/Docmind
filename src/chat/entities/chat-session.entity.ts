import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { ChatMessage } from './chat-message.entity';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto';

@Entity('chat_sessions')
export class ChatSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, default: 'New Chat' })
  title: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  workspaceId: string | null;

  @OneToMany(() => ChatMessage, (message) => message.session, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  messages: ChatMessage[];

  messagesMeta?: PaginationMetaDto;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
