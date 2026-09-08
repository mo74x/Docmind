import {
  Injectable,
  Logger,
  NotFoundException,
  MessageEvent,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Observable } from 'rxjs';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { QueryService } from '../query/query.service';
import { AnswerSource } from '../query/answer.service';
import { CreateChatSessionDto } from './dto/create-chat-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  PaginatedResponseDto,
  PaginationMetaDto,
} from '../common/dto/paginated-response.dto';
import { MessagePaginationDto } from './dto/message-pagination.dto';

export interface SendMessageResponse {
  sessionId: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  sources: AnswerSource[];
  standaloneQuery: string;
}

export interface ChatStreamSourcesEvent {
  type: 'sources';
  data: AnswerSource[];
  standaloneQuery: string;
}

export interface ChatStreamTokenEvent {
  type: 'token';
  content: string;
}

export interface ChatStreamDoneEvent {
  type: 'done';
  messageId: string;
  role: 'assistant';
}

export type ChatStreamEventData =
  ChatStreamSourcesEvent | ChatStreamTokenEvent | ChatStreamDoneEvent;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepo: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messageRepo: Repository<ChatMessage>,
    private readonly queryService: QueryService,
    private readonly configService: ConfigService,
  ) {
    this.openai = new OpenAI({
      apiKey:
        this.configService.get<string>('openai.apiKey') ||
        process.env.OPENAI_API_KEY ||
        'mock-key',
    });
    this.model =
      this.configService.get<string>('openai.chatModel') || 'gpt-4o-mini';
  }

  /**
   * Create a new chat session
   */
  async createSession(
    dto?: CreateChatSessionDto,
    workspaceId?: string | null,
  ): Promise<ChatSession> {
    const title = dto?.title?.trim() || 'New Chat';
    const session = this.sessionRepo.create({
      title,
      workspaceId: workspaceId ?? dto?.workspaceId ?? null,
    });
    const saved = await this.sessionRepo.save(session);
    this.logger.log(
      `Created chat session: ${saved.id} ("${saved.title}") in workspace ${saved.workspaceId || 'global'}`,
    );
    return saved;
  }

  /**
   * List chat sessions with pagination
   */
  async listSessions(
    paginationDto: PaginationDto,
    workspaceId?: string | null,
  ): Promise<PaginatedResponseDto<ChatSession>> {
    const page = paginationDto.page || 1;
    const limit = paginationDto.limit || 10;
    const order = paginationDto.order || 'DESC';
    const skip = (page - 1) * limit;

    const whereCondition = workspaceId ? { workspaceId } : undefined;

    const [sessions, total] = await this.sessionRepo.findAndCount({
      where: whereCondition,
      order: { updatedAt: order },
      skip,
      take: limit,
    });

    return new PaginatedResponseDto(sessions, total, page, limit);
  }

  /**
   * Retrieve a chat session with paginated messages ordered chronologically
   */
  async getSessionWithMessages(
    sessionId: string,
    paginationOrWorkspaceId?: MessagePaginationDto | string | null,
    workspaceIdParam?: string | null,
  ): Promise<ChatSession> {
    let paginationDto: MessagePaginationDto;
    let workspaceId: string | null | undefined;

    if (
      typeof paginationOrWorkspaceId === 'string' ||
      paginationOrWorkspaceId === null
    ) {
      paginationDto = new MessagePaginationDto();
      workspaceId = paginationOrWorkspaceId;
    } else {
      paginationDto = paginationOrWorkspaceId || new MessagePaginationDto();
      workspaceId = workspaceIdParam;
    }

    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Chat session ${sessionId} not found`);
    }

    if (workspaceId && session.workspaceId !== workspaceId) {
      throw new NotFoundException(`Chat session ${sessionId} not found`);
    }

    const page = paginationDto.page || 1;
    const limit = paginationDto.limit || 50;
    const order = paginationDto.order || 'ASC';
    const skip = (page - 1) * limit;

    const [messages, total] = await this.messageRepo.findAndCount({
      where: { sessionId },
      order: { createdAt: order },
      skip,
      take: limit,
    });

    session.messages = messages;
    session.messagesMeta = new PaginationMetaDto(total, page, limit);

    return session;
  }

  /**
   * List messages in a chat session with pagination
   */
  async listMessages(
    sessionId: string,
    paginationDto?: MessagePaginationDto,
    workspaceId?: string | null,
  ): Promise<PaginatedResponseDto<ChatMessage>> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Chat session ${sessionId} not found`);
    }

    if (workspaceId && session.workspaceId !== workspaceId) {
      throw new NotFoundException(`Chat session ${sessionId} not found`);
    }

    const pagination = paginationDto || new MessagePaginationDto();
    const page = pagination.page || 1;
    const limit = pagination.limit || 50;
    const order = pagination.order || 'ASC';
    const skip = (page - 1) * limit;

    const [messages, total] = await this.messageRepo.findAndCount({
      where: { sessionId },
      order: { createdAt: order },
      skip,
      take: limit,
    });

    return new PaginatedResponseDto(messages, total, page, limit);
  }

  /**
   * Delete a chat session and all its associated messages
   */
  async deleteSession(
    sessionId: string,
    workspaceId?: string | null,
  ): Promise<void> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Chat session ${sessionId} not found`);
    }

    if (workspaceId && session.workspaceId !== workspaceId) {
      throw new NotFoundException(`Chat session ${sessionId} not found`);
    }

    await this.sessionRepo.remove(session);
    this.logger.log(`Deleted chat session: ${sessionId}`);
  }

  /**
   * Rephrase a follow-up question into a standalone search query using chat history
   */
  async reformulateQuery(
    question: string,
    history: Array<{ role: string; content: string }>,
  ): Promise<string> {
    if (!history || history.length === 0) {
      return question;
    }

    const recentHistory = history
      .slice(-6)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');

    const prompt = `Given the chat history and follow-up question below, rephrase the follow-up question into a standalone, complete search query containing all necessary context and subject names (e.g., resolving pronouns like "it", "they", "this").
Do NOT answer the question. Only output the rephrased standalone query. If the question is already fully standalone, output it as-is.

Chat History:
${recentHistory}

Follow-up Question: ${question}
Standalone Query:`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'system', content: prompt }],
        temperature: 0.0,
        max_tokens: 150,
      });

      const rewritten = completion.choices[0]?.message?.content?.trim();
      if (rewritten && rewritten.length > 0) {
        this.logger.log(
          `Reformulated query from "${question}" -> "${rewritten}"`,
        );
        return rewritten;
      }
    } catch (err) {
      this.logger.warn(
        `Query reformulation failed, falling back to original query: ${
          (err as Error).message
        }`,
      );
    }

    return question;
  }

  /**
   * Send a message within a chat session (multi-turn RAG with query reformulation)
   */
  async sendMessage(
    sessionId: string,
    dto: SendMessageDto,
    workspaceId?: string | null,
  ): Promise<SendMessageResponse> {
    const session = await this.getSessionWithMessages(sessionId, workspaceId);

    // Auto-update session title if it's currently the default 'New Chat'
    if (session.title === 'New Chat') {
      const autoTitle = dto.content.trim().slice(0, 60);
      session.title = autoTitle;
      await this.sessionRepo.save(session);
    }

    // Step 1: Query Reformulation / Context Condensation
    const standaloneQuery = await this.reformulateQuery(
      dto.content,
      session.messages || [],
    );

    // Step 2: Knowledge Retrieval (Hybrid / Vector / FTS) bounded to workspace
    const searchResults = await this.queryService.search(
      {
        query: standaloneQuery,
        limit: dto.limit || 5,
        mode: dto.mode || 'hybrid',
      },
      session.workspaceId,
    );

    const sources: AnswerSource[] = searchResults.map((result, idx) => ({
      citation: `[Source ${idx + 1}]`,
      documentTitle: result.documentTitle,
      chunkId: result.chunkId,
      similarity: result.similarity,
    }));

    // Step 3: Prompt Construction with History & Context
    const formattedContext = searchResults
      .map(
        (result, index) =>
          `[Source ${index + 1}] (Document: ${result.documentTitle}):\n${result.content}`,
      )
      .join('\n\n---\n\n');

    const systemPrompt = `You are an expert AI assistant with conversational memory and knowledge retrieval. Answer the user's question accurately using the provided sources and the ongoing conversation history.
RULES:
1. Cite facts from the provided sources using inline notation like [Source 1], [Source 2].
2. If the sources do not provide sufficient information, clearly state what is missing while answering conversationally based on history.
3. Do not invent citations or information not grounded in the sources.

SOURCES:
${formattedContext || 'No relevant sources found in knowledge base.'}`;

    const historyMessages: OpenAI.Chat.ChatCompletionMessageParam[] = (
      session.messages || []
    )
      .slice(-8)
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // Step 4: Call OpenAI Chat Completion
    const completion = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
        { role: 'user', content: dto.content },
      ],
      temperature: 0.2,
    });

    const assistantContent =
      completion.choices[0]?.message?.content ||
      'I apologize, but I was unable to formulate a response.';

    // Step 5: Persist Both Messages to PostgreSQL
    const userMsg = this.messageRepo.create({
      sessionId,
      role: 'user',
      content: dto.content,
    });
    const savedUserMsg = await this.messageRepo.save(userMsg);

    const assistantMsg = this.messageRepo.create({
      sessionId,
      role: 'assistant',
      content: assistantContent,
      sources: sources.length > 0 ? sources : null,
    });
    const savedAssistantMsg = await this.messageRepo.save(assistantMsg);

    // Update session timestamp
    await this.sessionRepo.update(sessionId, { updatedAt: new Date() });

    return {
      sessionId,
      userMessage: savedUserMsg,
      assistantMessage: savedAssistantMsg,
      sources,
      standaloneQuery,
    };
  }

  /**
   * Stream conversational RAG response via Server-Sent Events (SSE)
   */
  sendMessageStream(
    sessionId: string,
    dto: SendMessageDto,
    workspaceId?: string | null,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let isAborted = false;

      void (async () => {
        try {
          const session = await this.getSessionWithMessages(
            sessionId,
            workspaceId,
          );

          if (session.title === 'New Chat') {
            session.title = dto.content.trim().slice(0, 60);
            await this.sessionRepo.save(session);
          }

          // Step 1: Query Reformulation
          const standaloneQuery = await this.reformulateQuery(
            dto.content,
            session.messages || [],
          );

          if (isAborted) return;

          // Step 2: Knowledge Retrieval bounded to session workspace
          const searchResults = await this.queryService.search(
            {
              query: standaloneQuery,
              limit: dto.limit || 5,
              mode: dto.mode || 'hybrid',
            },
            session.workspaceId,
          );

          if (isAborted) return;

          const sources: AnswerSource[] = searchResults.map((result, idx) => ({
            citation: `[Source ${idx + 1}]`,
            documentTitle: result.documentTitle,
            chunkId: result.chunkId,
            similarity: result.similarity,
          }));

          // Emit initial sources event
          subscriber.next({
            data: {
              type: 'sources',
              data: sources,
              standaloneQuery,
            },
          });

          // Step 3: Build Context & History
          const formattedContext = searchResults
            .map(
              (result, index) =>
                `[Source ${index + 1}] (Document: ${result.documentTitle}):\n${result.content}`,
            )
            .join('\n\n---\n\n');

          const systemPrompt = `You are an expert AI assistant with conversational memory and knowledge retrieval. Answer the user's question accurately using the provided sources and the ongoing conversation history.
RULES:
1. Cite facts from the provided sources using inline notation like [Source 1], [Source 2].
2. If the sources do not provide sufficient information, clearly state what is missing while answering conversationally based on history.
3. Do not invent citations or information not grounded in the sources.

SOURCES:
${formattedContext || 'No relevant sources found in knowledge base.'}`;

          const historyMessages: OpenAI.Chat.ChatCompletionMessageParam[] = (
            session.messages || []
          )
            .slice(-8)
            .map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            }));

          // Save user message immediately
          const userMsg = this.messageRepo.create({
            sessionId,
            role: 'user',
            content: dto.content,
          });
          await this.messageRepo.save(userMsg);

          // Step 4: Stream Tokens from OpenAI
          const stream = await this.openai.chat.completions.create({
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              ...historyMessages,
              { role: 'user', content: dto.content },
            ],
            temperature: 0.2,
            stream: true,
          });

          let fullAnswer = '';

          for await (const chunk of stream) {
            if (isAborted) break;

            const deltaContent = chunk.choices[0]?.delta?.content || '';
            if (deltaContent) {
              fullAnswer += deltaContent;
              subscriber.next({
                data: {
                  type: 'token',
                  content: deltaContent,
                },
              });
            }
          }

          if (isAborted) return;

          // Step 5: Save Assistant Response to PostgreSQL
          const assistantMsg = this.messageRepo.create({
            sessionId,
            role: 'assistant',
            content: fullAnswer,
            sources: sources.length > 0 ? sources : null,
          });
          const savedAssistant = await this.messageRepo.save(assistantMsg);

          await this.sessionRepo.update(sessionId, { updatedAt: new Date() });

          // Emit Done Event
          subscriber.next({
            data: {
              type: 'done',
              messageId: savedAssistant.id,
              role: 'assistant',
            },
          });

          subscriber.complete();
        } catch (err) {
          if (!isAborted) {
            this.logger.error(
              `Error during chat message streaming: ${(err as Error).message}`,
              (err as Error).stack,
            );
            subscriber.error(err);
          }
        }
      })();

      return () => {
        isAborted = true;
      };
    });
  }
}
