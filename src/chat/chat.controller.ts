import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Sse,
  Res,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  MessageEvent,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Observable } from 'rxjs';
import type { Response } from 'express';
import { ChatService, SendMessageResponse } from './chat.service';
import { CreateChatSessionDto } from './dto/create-chat-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { StreamMessageQueryDto } from './dto/stream-message-query.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { MessagePaginationDto } from './dto/message-pagination.dto';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { CurrentWorkspaceId } from '../auth/decorators/current-workspace.decorator';

@ApiTags('Chat & Conversational Memory')
@Controller('chat')
@UseGuards(ThrottlerGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new multi-turn chat session' })
  @ApiResponse({
    status: 201,
    description: 'Chat session created successfully',
    type: ChatSession,
  })
  async createSession(
    @Body() dto: CreateChatSessionDto,
    @CurrentWorkspaceId() workspaceId: string | null,
  ): Promise<ChatSession> {
    const effectiveWorkspaceId = workspaceId || dto?.workspaceId || null;
    return this.chatService.createSession(dto, effectiveWorkspaceId);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List chat sessions with pagination' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of chat sessions',
    type: PaginatedResponseDto,
  })
  async listSessions(
    @Query() paginationDto: PaginationDto,
    @CurrentWorkspaceId() workspaceId: string | null,
  ): Promise<PaginatedResponseDto<ChatSession>> {
    return this.chatService.listSessions(paginationDto, workspaceId);
  }

  @Get('sessions/:id')
  @ApiOperation({
    summary:
      'Retrieve a chat session with paginated chronological message history',
  })
  @ApiParam({ name: 'id', description: 'UUID of the chat session' })
  @ApiResponse({
    status: 200,
    description:
      'Chat session with messages and messagesMeta pagination metadata',
    type: ChatSession,
  })
  @ApiResponse({ status: 404, description: 'Chat session not found' })
  async getSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() paginationDto: MessagePaginationDto,
    @CurrentWorkspaceId() workspaceId: string | null,
  ): Promise<ChatSession> {
    if (typeof paginationDto === 'string' || paginationDto === null) {
      return this.chatService.getSessionWithMessages(
        id,
        new MessagePaginationDto(),
        paginationDto,
      );
    }
    return this.chatService.getSessionWithMessages(
      id,
      paginationDto,
      workspaceId,
    );
  }

  @Get('sessions/:id/messages')
  @ApiOperation({
    summary: 'List messages in a chat session with pagination',
  })
  @ApiParam({ name: 'id', description: 'UUID of the chat session' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of chat messages',
    type: PaginatedResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Chat session not found' })
  async listMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() paginationDto: MessagePaginationDto,
    @CurrentWorkspaceId() workspaceId: string | null,
  ): Promise<PaginatedResponseDto<ChatMessage>> {
    return this.chatService.listMessages(id, paginationDto, workspaceId);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a chat session and all its messages' })
  @ApiParam({ name: 'id', description: 'UUID of the chat session' })
  @ApiResponse({
    status: 200,
    description: 'Chat session deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Chat session not found' })
  async deleteSession(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspaceId() workspaceId: string | null,
  ): Promise<{ message: string; id: string }> {
    await this.chatService.deleteSession(id, workspaceId);
    return {
      message: 'Chat session deleted successfully',
      id,
    };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('sessions/:id/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Send a message to a session (multi-turn RAG with query reformulation)',
  })
  @ApiParam({ name: 'id', description: 'UUID of the chat session' })
  @ApiResponse({
    status: 200,
    description:
      'Returns the assistant response, citations, and reformulated query',
  })
  @ApiResponse({ status: 404, description: 'Chat session not found' })
  async sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @CurrentWorkspaceId() workspaceId: string | null,
  ): Promise<SendMessageResponse> {
    return this.chatService.sendMessage(id, dto, workspaceId);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Sse('sessions/:id/messages/stream')
  @ApiOperation({
    summary: 'Stream conversational RAG answer token-by-token via SSE (GET)',
  })
  @ApiParam({ name: 'id', description: 'UUID of the chat session' })
  @ApiQuery({
    name: 'content',
    required: true,
    type: String,
    description: 'Follow-up question or message',
  })
  @ApiQuery({
    name: 'mode',
    required: false,
    enum: ['vector', 'fts', 'hybrid'],
    description: 'Retrieval mode',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Context chunks limit',
  })
  @ApiResponse({
    status: 200,
    description: 'SSE stream delivering citations, tokens, and done event',
  })
  sendMessageStreamGet(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() dto: StreamMessageQueryDto,
    @CurrentWorkspaceId() workspaceId: string | null,
  ): Observable<MessageEvent> {
    return this.chatService.sendMessageStream(id, dto, workspaceId);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('sessions/:id/messages/stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Stream conversational RAG answer token-by-token via SSE (POST body)',
  })
  @ApiParam({ name: 'id', description: 'UUID of the chat session' })
  @ApiResponse({
    status: 200,
    description: 'SSE stream delivering citations, tokens, and done event',
  })
  sendMessageStreamPost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
    @CurrentWorkspaceId() workspaceId: string | null,
  ): void {
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const subscription = this.chatService
      .sendMessageStream(id, dto, workspaceId)
      .subscribe({
        next: (event) => {
          res.write(`data: ${JSON.stringify(event.data)}\n\n`);
        },
        error: (err: unknown) => {
          const errorMsg =
            err instanceof Error
              ? err.message
              : 'Internal error during chat streaming';
          res.write(
            `data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`,
          );
          res.end();
        },
        complete: () => {
          res.end();
        },
      });

    res.on('close', () => {
      subscription.unsubscribe();
    });
  }
}
