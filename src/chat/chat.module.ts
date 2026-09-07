import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { QueryModule } from '../query/query.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatSession, ChatMessage]),
    QueryModule,
    ConfigModule,
  ],
  providers: [ChatService],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
