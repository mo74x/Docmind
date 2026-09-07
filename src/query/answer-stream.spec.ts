/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getToken } from '@willsoto/nestjs-prometheus';
import { MessageEvent } from '@nestjs/common';
import * as crypto from 'crypto';
import { AnswerService } from './answer.service';
import { QueryService, SearchResult } from './query.service';
import { SearchQueryDto } from './dto/search-query.dto';

describe('AnswerService - Streaming RAG (SSE)', () => {
  let service: AnswerService;
  let redisMock: {
    get: jest.Mock;
    set: jest.Mock;
  };
  let configServiceMock: {
    get: jest.Mock;
  };
  let queryServiceMock: {
    search: jest.Mock;
  };
  let queriesCounterMock: {
    inc: jest.Mock;
  };
  let cacheHitsCounterMock: {
    inc: jest.Mock;
  };
  let generationTimerMock: {
    startTimer: jest.Mock;
  };
  let vectorSearchTimerMock: {
    startTimer: jest.Mock;
  };
  let endTimerMock: jest.Mock;
  let openaiCreateMock: jest.Mock;

  beforeEach(async () => {
    endTimerMock = jest.fn();
    openaiCreateMock = jest.fn();

    redisMock = {
      get: jest.fn(),
      set: jest.fn(),
    };

    configServiceMock = {
      get: jest.fn((key: string) => {
        if (key === 'openai.apiKey') return 'test-openai-key';
        if (key === 'openai.chatModel') return 'gpt-4o-mini';
        return null;
      }),
    };

    queryServiceMock = {
      search: jest.fn(),
    };

    queriesCounterMock = {
      inc: jest.fn(),
    };

    cacheHitsCounterMock = {
      inc: jest.fn(),
    };

    generationTimerMock = {
      startTimer: jest.fn().mockReturnValue(endTimerMock),
    };

    vectorSearchTimerMock = {
      startTimer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnswerService,
        { provide: 'REDIS_CLIENT', useValue: redisMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: QueryService, useValue: queryServiceMock },
        {
          provide: getToken('rag_queries_total'),
          useValue: queriesCounterMock,
        },
        {
          provide: getToken('rag_cache_hits_total'),
          useValue: cacheHitsCounterMock,
        },
        {
          provide: getToken('llm_generation_duration_seconds'),
          useValue: generationTimerMock,
        },
        {
          provide: getToken('vector_search_latency_seconds'),
          useValue: vectorSearchTimerMock,
        },
      ],
    }).compile();

    service = module.get<AnswerService>(AnswerService);

    (service as any).openai = {
      chat: {
        completions: {
          create: openaiCreateMock,
        },
      },
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const getExpectedCacheKey = (
    query: string,
    workspaceId?: string | null,
  ): string => {
    const normalized = query
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    const ws = workspaceId || 'global';
    return `docmind:cache:ask:${ws}:${hash}`;
  };

  function* createMockStream(tokens: string[]) {
    for (const token of tokens) {
      yield {
        choices: [
          {
            delta: { content: token },
          },
        ],
      };
    }
  }

  describe('askQuestionStream - Cache Hit', () => {
    it('should stream cached answer and citations without invoking OpenAI or vector search', async () => {
      const dto: SearchQueryDto = { query: 'What is DocMind streaming?' };
      const expectedCacheKey = getExpectedCacheKey(dto.query);

      const cachedPayload = {
        query: dto.query,
        answer: 'DocMind supports real-time token streaming via SSE.',
        sources: [
          {
            citation: '[Source 1]',
            documentTitle: 'Streaming Guide',
            chunkId: 'chunk-123',
            similarity: 0.96,
          },
        ],
        isCached: true,
      };

      redisMock.get.mockResolvedValue(JSON.stringify(cachedPayload));

      const events: MessageEvent[] = [];
      await new Promise<void>((resolve, reject) => {
        service.askQuestionStream(dto).subscribe({
          next: (e) => events.push(e),
          error: reject,
          complete: resolve,
        });
      });

      expect(queriesCounterMock.inc).toHaveBeenCalledTimes(1);
      expect(cacheHitsCounterMock.inc).toHaveBeenCalledTimes(1);
      expect(redisMock.get).toHaveBeenCalledWith(expectedCacheKey);
      expect(queryServiceMock.search).not.toHaveBeenCalled();
      expect(openaiCreateMock).not.toHaveBeenCalled();

      expect(events).toEqual([
        {
          data: {
            type: 'sources',
            data: cachedPayload.sources,
          },
        },
        {
          data: {
            type: 'token',
            content: cachedPayload.answer,
          },
        },
        {
          data: {
            type: 'done',
            isCached: true,
          },
        },
      ]);
    });
  });

  describe('askQuestionStream - Cache Miss (Fresh Generation)', () => {
    it('should perform vector search, stream incremental tokens, write to Redis cache, and emit done event', async () => {
      const dto: SearchQueryDto = {
        query: 'How does SSE streaming work in DocMind?',
      };
      const expectedCacheKey = getExpectedCacheKey(dto.query);

      redisMock.get.mockResolvedValue(null);

      const mockSearchResults: SearchResult[] = [
        {
          chunkId: 'chunk-abc',
          documentId: 'doc-1',
          documentTitle: 'Architecture Whitepaper',
          content: 'DocMind uses Server-Sent Events to stream LLM tokens.',
          similarity: 0.92,
        },
      ];

      queryServiceMock.search.mockResolvedValue(mockSearchResults);

      const tokens = ['DocMind ', 'streams ', 'tokens ', 'via SSE.'];
      openaiCreateMock.mockResolvedValue(createMockStream(tokens));

      const events: MessageEvent[] = [];
      await new Promise<void>((resolve, reject) => {
        service.askQuestionStream(dto).subscribe({
          next: (e) => events.push(e),
          error: reject,
          complete: resolve,
        });
      });

      expect(queriesCounterMock.inc).toHaveBeenCalledTimes(1);
      expect(cacheHitsCounterMock.inc).not.toHaveBeenCalled();
      expect(redisMock.get).toHaveBeenCalledWith(expectedCacheKey);
      expect(queryServiceMock.search).toHaveBeenCalledWith(dto, null);
      expect(generationTimerMock.startTimer).toHaveBeenCalledTimes(1);
      expect(endTimerMock).toHaveBeenCalledTimes(1);

      expect(openaiCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          stream: true,
          temperature: 0.1,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ role: 'user', content: dto.query }),
          ]),
        }),
      );

      // Verify cached payload written to Redis
      expect(redisMock.set).toHaveBeenCalledWith(
        expectedCacheKey,
        JSON.stringify({
          query: dto.query,
          answer: 'DocMind streams tokens via SSE.',
          sources: [
            {
              citation: '[Source 1]',
              documentTitle: 'Architecture Whitepaper',
              chunkId: 'chunk-abc',
              similarity: 0.92,
            },
          ],
          isCached: true,
        }),
        'EX',
        86400,
      );

      // Verify sequence of emitted events
      expect(events[0]).toEqual({
        data: {
          type: 'sources',
          data: [
            {
              citation: '[Source 1]',
              documentTitle: 'Architecture Whitepaper',
              chunkId: 'chunk-abc',
              similarity: 0.92,
            },
          ],
        },
      });

      expect(events[1]).toEqual({
        data: { type: 'token', content: 'DocMind ' },
      });
      expect(events[2]).toEqual({
        data: { type: 'token', content: 'streams ' },
      });
      expect(events[3]).toEqual({
        data: { type: 'token', content: 'tokens ' },
      });
      expect(events[4]).toEqual({
        data: { type: 'token', content: 'via SSE.' },
      });

      expect(events[5]).toEqual({
        data: {
          type: 'done',
          isCached: false,
        },
      });
    });

    it('should return fallback message when search results are empty', async () => {
      const dto: SearchQueryDto = { query: 'Unknown query' };
      redisMock.get.mockResolvedValue(null);
      queryServiceMock.search.mockResolvedValue([]);

      const events: MessageEvent[] = [];
      await new Promise<void>((resolve, reject) => {
        service.askQuestionStream(dto).subscribe({
          next: (e) => events.push(e),
          error: reject,
          complete: resolve,
        });
      });

      expect(queryServiceMock.search).toHaveBeenCalledWith(dto, null);
      expect(openaiCreateMock).not.toHaveBeenCalled();
      expect(endTimerMock).toHaveBeenCalledTimes(1);

      expect(events).toEqual([
        {
          data: {
            type: 'sources',
            data: [],
          },
        },
        {
          data: {
            type: 'token',
            content: 'No matching documents found.',
          },
        },
        {
          data: {
            type: 'done',
            isCached: false,
          },
        },
      ]);
    });

    it('should handle OpenAI API errors gracefully and stop timer', async () => {
      const dto: SearchQueryDto = { query: 'Query with error' };
      redisMock.get.mockResolvedValue(null);
      queryServiceMock.search.mockResolvedValue([
        {
          chunkId: 'chunk-1',
          documentId: 'doc-1',
          documentTitle: 'Title',
          content: 'Content',
          similarity: 0.9,
        },
      ]);

      openaiCreateMock.mockRejectedValue(
        new Error('OpenAI service overloaded'),
      );

      await expect(
        new Promise<void>((resolve, reject) => {
          service.askQuestionStream(dto).subscribe({
            next: () => {},
            error: reject,
            complete: resolve,
          });
        }),
      ).rejects.toThrow('OpenAI service overloaded');

      expect(endTimerMock).toHaveBeenCalledTimes(1);
    });

    it('should abort cleanly when client unsubscribes early', async () => {
      const dto: SearchQueryDto = { query: 'Aborted query' };
      redisMock.get.mockResolvedValue(null);
      queryServiceMock.search.mockResolvedValue([
        {
          chunkId: 'chunk-1',
          documentId: 'doc-1',
          documentTitle: 'Title',
          content: 'Content',
          similarity: 0.9,
        },
      ]);

      const slowStream = (async function* () {
        yield { choices: [{ delta: { content: 'Token 1 ' } }] };
        await new Promise((r) => setTimeout(r, 100));
        yield { choices: [{ delta: { content: 'Token 2' } }] };
      })();

      openaiCreateMock.mockResolvedValue(slowStream);

      const events: MessageEvent[] = [];
      const subscription = service.askQuestionStream(dto).subscribe({
        next: (e) => {
          events.push(e);
          // Unsubscribe immediately after receiving first event
          subscription.unsubscribe();
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(events.length).toBeGreaterThan(0);
    });
  });
});
