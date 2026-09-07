/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { ChatService, ChatStreamEventData } from './chat.service';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { QueryService } from '../query/query.service';

describe('ChatService', () => {
  let service: ChatService;
  let sessionRepoMock: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    findAndCount: jest.Mock;
    remove: jest.Mock;
    update: jest.Mock;
  };
  let messageRepoMock: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let queryServiceMock: {
    search: jest.Mock;
  };
  let configServiceMock: {
    get: jest.Mock;
  };
  let openaiCreateMock: jest.Mock;

  beforeEach(async () => {
    openaiCreateMock = jest.fn();

    sessionRepoMock = {
      create: jest.fn((dto) => ({
        id: 'session-uuid-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...dto,
      })),
      save: jest.fn((entity) =>
        Promise.resolve({
          id: 'session-uuid-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...entity,
        }),
      ),
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      remove: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    messageRepoMock = {
      create: jest.fn((dto) => ({
        id: 'msg-uuid-' + Math.random(),
        createdAt: new Date(),
        ...dto,
      })),
      save: jest.fn((entity) =>
        Promise.resolve({
          id: 'msg-uuid-' + Math.random(),
          createdAt: new Date(),
          ...entity,
        }),
      ),
    };

    queryServiceMock = {
      search: jest.fn(),
    };

    configServiceMock = {
      get: jest.fn((key: string) => {
        if (key === 'openai.apiKey') return 'mock-key';
        if (key === 'openai.chatModel') return 'gpt-4o-mini';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: getRepositoryToken(ChatSession),
          useValue: sessionRepoMock,
        },
        {
          provide: getRepositoryToken(ChatMessage),
          useValue: messageRepoMock,
        },
        {
          provide: QueryService,
          useValue: queryServiceMock,
        },
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    // Inject mock into private openai instance
    (
      service as unknown as {
        openai: { chat: { completions: { create: jest.Mock } } };
      }
    ).openai = {
      chat: {
        completions: {
          create: openaiCreateMock,
        },
      },
    };
  });

  describe('createSession', () => {
    it('should create a chat session with provided title', async () => {
      const result = await service.createSession({
        title: 'Architecture Query',
        workspaceId: 'ws-1',
      });

      expect(sessionRepoMock.create).toHaveBeenCalledWith({
        title: 'Architecture Query',
        workspaceId: 'ws-1',
      });
      expect(sessionRepoMock.save).toHaveBeenCalled();
      expect(result.title).toBe('Architecture Query');
    });

    it('should default title to "New Chat" when title is omitted', async () => {
      const result = await service.createSession();

      expect(sessionRepoMock.create).toHaveBeenCalledWith({
        title: 'New Chat',
        workspaceId: null,
      });
      expect(result.title).toBe('New Chat');
    });
  });

  describe('listSessions', () => {
    it('should return paginated sessions', async () => {
      const mockSessions = [
        { id: 'sess-1', title: 'Session 1', createdAt: new Date() },
        { id: 'sess-2', title: 'Session 2', createdAt: new Date() },
      ];
      sessionRepoMock.findAndCount.mockResolvedValue([mockSessions, 2]);

      const result = await service.listSessions({
        page: 1,
        limit: 10,
        order: 'DESC',
      });

      expect(sessionRepoMock.findAndCount).toHaveBeenCalledWith({
        order: { updatedAt: 'DESC' },
        skip: 0,
        take: 10,
      });
      expect(result.data).toHaveLength(2);
      expect(result.meta.totalItems).toBe(2);
      expect(result.meta.totalPages).toBe(1);
    });
  });

  describe('getSessionWithMessages', () => {
    it('should return the session with chronologically ordered messages', async () => {
      const mockSession = {
        id: 'sess-1',
        title: 'DocMind Chat',
        messages: [
          { id: 'm1', role: 'user', content: 'Hi' },
          { id: 'm2', role: 'assistant', content: 'Hello!' },
        ],
      };
      sessionRepoMock.findOne.mockResolvedValue(mockSession);

      const result = await service.getSessionWithMessages('sess-1');

      expect(sessionRepoMock.findOne).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        relations: { messages: true },
        order: { messages: { createdAt: 'ASC' } },
      });
      expect(result.messages).toHaveLength(2);
    });

    it('should throw NotFoundException if session does not exist', async () => {
      sessionRepoMock.findOne.mockResolvedValue(null);

      await expect(
        service.getSessionWithMessages('non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteSession', () => {
    it('should remove the session successfully', async () => {
      const mockSession = { id: 'sess-1' };
      sessionRepoMock.findOne.mockResolvedValue(mockSession);

      await service.deleteSession('sess-1');

      expect(sessionRepoMock.remove).toHaveBeenCalledWith(mockSession);
    });

    it('should throw NotFoundException when deleting non-existent session', async () => {
      sessionRepoMock.findOne.mockResolvedValue(null);

      await expect(service.deleteSession('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reformulateQuery', () => {
    it('should return question as-is if history is empty', async () => {
      const result = await service.reformulateQuery('What is DocMind?', []);
      expect(result).toBe('What is DocMind?');
      expect(openaiCreateMock).not.toHaveBeenCalled();
    });

    it('should call OpenAI to reformulate follow-up question when history exists', async () => {
      openaiCreateMock.mockResolvedValue({
        choices: [
          {
            message: {
              content:
                'What is the default overlap size for the DocMind chunker?',
            },
          },
        ],
      });

      const history: ChatMessage[] = [
        {
          id: '1',
          sessionId: 'sess-1',
          role: 'user',
          content: 'What is DocMind chunking strategy?',
          createdAt: new Date(),
          session: null as any,
          sources: null,
        },
        {
          id: '2',
          sessionId: 'sess-1',
          role: 'assistant',
          content: 'It uses character-level chunking.',
          createdAt: new Date(),
          session: null as any,
          sources: null,
        },
      ];

      const result = await service.reformulateQuery(
        'What is the default overlap size?',
        history,
      );

      expect(openaiCreateMock).toHaveBeenCalled();
      expect(result).toBe(
        'What is the default overlap size for the DocMind chunker?',
      );
    });

    it('should gracefully fallback to original question if OpenAI fails', async () => {
      openaiCreateMock.mockRejectedValue(new Error('OpenAI timeout'));

      const history: ChatMessage[] = [
        {
          id: '1',
          sessionId: 'sess-1',
          role: 'user',
          content: 'Hello',
          createdAt: new Date(),
          session: null as any,
          sources: null,
        },
      ];

      const result = await service.reformulateQuery(
        'What is the overlap?',
        history,
      );
      expect(result).toBe('What is the overlap?');
    });
  });

  describe('sendMessage', () => {
    it('should execute multi-turn RAG, reformulate query, retrieve chunks, and save messages', async () => {
      const mockSession = {
        id: 'sess-1',
        title: 'New Chat',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'What is DocMind?',
            createdAt: new Date(),
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'DocMind is a RAG platform.',
            createdAt: new Date(),
          },
        ],
      };
      sessionRepoMock.findOne.mockResolvedValue(mockSession);

      // Mock reformulation response
      openaiCreateMock
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: 'How does DocMind handle background processing?',
              },
            },
          ],
        })
        // Mock final chat completion
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content:
                  'DocMind uses BullMQ and Redis for background processing [Source 1].',
              },
            },
          ],
        });

      queryServiceMock.search.mockResolvedValue([
        {
          chunkId: 'chunk-1',
          content: 'DocMind uses BullMQ for async ingestion.',
          documentTitle: 'Architecture Overview',
          similarity: 0.95,
        },
      ]);

      const response = await service.sendMessage('sess-1', {
        content: 'How does it handle background tasks?',
        mode: 'hybrid',
        limit: 3,
      });

      expect(response.sessionId).toBe('sess-1');
      expect(response.standaloneQuery).toBe(
        'How does DocMind handle background processing?',
      );
      expect(queryServiceMock.search).toHaveBeenCalledWith({
        query: 'How does DocMind handle background processing?',
        limit: 3,
        mode: 'hybrid',
      });
      expect(response.sources).toHaveLength(1);
      expect(response.sources[0].citation).toBe('[Source 1]');
      expect(messageRepoMock.save).toHaveBeenCalledTimes(2); // user and assistant
      expect(sessionRepoMock.update).toHaveBeenCalledWith(
        'sess-1',
        expect.any(Object),
      );
    });

    it('should auto-update session title on first message', async () => {
      const mockSession = {
        id: 'sess-1',
        title: 'New Chat',
        messages: [],
      };
      sessionRepoMock.findOne.mockResolvedValue(mockSession);

      openaiCreateMock.mockResolvedValueOnce({
        choices: [
          { message: { content: 'DocMind is a TypeScript RAG platform.' } },
        ],
      });

      queryServiceMock.search.mockResolvedValue([]);

      await service.sendMessage('sess-1', { content: 'Tell me about DocMind' });

      expect(mockSession.title).toBe('Tell me about DocMind');
      expect(sessionRepoMock.save).toHaveBeenCalledWith(mockSession);
    });
  });

  describe('sendMessageStream', () => {
    it('should stream sources, incremental tokens, and done event via SSE', async () => {
      const mockSession = {
        id: 'sess-1',
        title: 'Chat Session',
        messages: [],
      };
      sessionRepoMock.findOne.mockResolvedValue(mockSession);

      queryServiceMock.search.mockResolvedValue([
        {
          chunkId: 'c1',
          content: 'Chunk content',
          documentTitle: 'Doc 1',
          similarity: 0.9,
        },
      ]);

      // Mock async generator stream
      function* mockGenerator() {
        yield { choices: [{ delta: { content: 'DocMind ' } }] };
        yield { choices: [{ delta: { content: 'is ' } }] };
        yield { choices: [{ delta: { content: 'fast.' } }] };
      }
      openaiCreateMock.mockResolvedValueOnce(mockGenerator());

      const events: ChatStreamEventData[] = [];

      await new Promise<void>((resolve, reject) => {
        service
          .sendMessageStream('sess-1', { content: 'Is DocMind fast?' })
          .subscribe({
            next: (event) => {
              events.push(event.data as ChatStreamEventData);
            },
            error: reject,
            complete: resolve,
          });
      });

      expect(events[0].type).toBe('sources');
      expect((events[0] as any).data).toHaveLength(1);

      const tokenEvents = events.filter((e) => e.type === 'token');
      expect(tokenEvents).toHaveLength(3);

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
      expect(doneEvent?.type).toBe('done');

      // Both user and assistant message should be persisted
      expect(messageRepoMock.save).toHaveBeenCalledTimes(2);
    });
  });
});
