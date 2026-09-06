/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getToken } from '@willsoto/nestjs-prometheus';
import * as crypto from 'crypto';
import { AnswerService } from './answer.service';
import { QueryService } from './query.service';
import { SearchQueryDto } from './dto/search-query.dto';

describe('AnswerService', () => {
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

    // Mock the internal OpenAI instance created in constructor
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

  const getExpectedCacheKey = (query: string): string => {
    const normalized = query
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    return `docmind:cache:ask:${hash}`;
  };

  describe('Cache Hit', () => {
    it('should return cached JSON instantly without hitting OpenAI or vector search', async () => {
      const dto: SearchQueryDto = { query: 'What is DocMind?' };
      const expectedCacheKey = getExpectedCacheKey(dto.query);

      const cachedPayload = {
        query: 'What is DocMind?',
        answer: 'DocMind is an asynchronous RAG backend.',
        sources: [
          {
            citation: '[Source 1]',
            documentTitle: 'DocMind Overview',
            chunkId: 'chunk-1',
            similarity: 0.95,
          },
        ],
        isCached: true,
      };

      redisMock.get.mockResolvedValue(JSON.stringify(cachedPayload));

      const result = await service.askQuestion(dto);

      // Verify returned result matches cached payload
      expect(result).toEqual(cachedPayload);

      // Verify Redis get was called with correct cache key
      expect(redisMock.get).toHaveBeenCalledWith(expectedCacheKey);
      expect(redisMock.get).toHaveBeenCalledTimes(1);

      // Verify metrics
      expect(queriesCounterMock.inc).toHaveBeenCalledTimes(1);
      expect(cacheHitsCounterMock.inc).toHaveBeenCalledTimes(1);

      // Verify that QueryService and OpenAI were NOT touched
      expect(queryServiceMock.search).not.toHaveBeenCalled();
      expect(openaiCreateMock).not.toHaveBeenCalled();
      expect(generationTimerMock.startTimer).not.toHaveBeenCalled();
      expect(redisMock.set).not.toHaveBeenCalled();
    });

    it('should hit cache for queries with varied punctuation, casing, and irregular spaces', async () => {
      const dto: SearchQueryDto = { query: '  WHAT is   DocMind???  ' };
      const expectedKey = getExpectedCacheKey('what is docmind');

      redisMock.get.mockResolvedValue(
        JSON.stringify({
          query: 'what is docmind',
          answer: 'Normalized cached answer.',
          sources: [],
          isCached: true,
        }),
      );

      await service.askQuestion(dto);

      expect(redisMock.get).toHaveBeenCalledWith(expectedKey);
      expect(cacheHitsCounterMock.inc).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cache Miss', () => {
    it('should invoke QueryService.search, construct strict system prompt, call OpenAI chat, and write result to Redis', async () => {
      const dto: SearchQueryDto = { query: 'How does ingestion work?' };
      const expectedCacheKey = getExpectedCacheKey(dto.query);

      // Cache returns null
      redisMock.get.mockResolvedValue(null);

      // Mock vector search results
      const mockSearchResults = [
        {
          chunkId: 'c-101',
          content: 'Ingestion is queued with BullMQ.',
          similarity: 0.91,
          documentTitle: 'Architecture Guide',
          documentId: 'doc-1',
        },
        {
          chunkId: 'c-102',
          content: 'Chunks are embedded using text-embedding-3-small.',
          similarity: 0.87,
          documentTitle: 'Embedding Pipeline',
          documentId: 'doc-2',
        },
      ];
      queryServiceMock.search.mockResolvedValue(mockSearchResults);

      // Mock OpenAI chat completion response
      const openAiResponse = {
        choices: [
          {
            message: {
              content:
                'Ingestion uses BullMQ [Source 1] and embeddings [Source 2].',
            },
          },
        ],
      };
      openaiCreateMock.mockResolvedValue(openAiResponse);

      const result = await service.askQuestion(dto);

      // 1. Verify Redis check
      expect(redisMock.get).toHaveBeenCalledWith(expectedCacheKey);

      // 2. Verify QueryService.search called
      expect(queryServiceMock.search).toHaveBeenCalledWith(dto);
      expect(queryServiceMock.search).toHaveBeenCalledTimes(1);

      // 3. Verify strict system prompt formatting
      expect(openaiCreateMock).toHaveBeenCalledTimes(1);
      const openAiCallArgs = openaiCreateMock.mock.calls[0][0];

      expect(openAiCallArgs.model).toBe('gpt-4o-mini');
      expect(openAiCallArgs.temperature).toBe(0.1);
      expect(openAiCallArgs.messages).toHaveLength(2);

      const [systemMessage, userMessage] = openAiCallArgs.messages;
      expect(systemMessage.role).toBe('system');
      expect(systemMessage.content).toContain(
        'You are a highly precise knowledge-base assistant.',
      );
      expect(systemMessage.content).toContain(
        "Answer the user's question using ONLY the provided sources below.",
      );
      expect(systemMessage.content).toContain('RULES:');
      expect(systemMessage.content).toContain(
        '1. Cite sources inline as [Source N].',
      );
      expect(systemMessage.content).toContain('2. Do not hallucinate.');
      expect(systemMessage.content).toContain(
        '[Source 1] (Document: Architecture Guide):\nIngestion is queued with BullMQ.',
      );
      expect(systemMessage.content).toContain(
        '[Source 2] (Document: Embedding Pipeline):\nChunks are embedded using text-embedding-3-small.',
      );

      expect(userMessage.role).toBe('user');
      expect(userMessage.content).toBe(dto.query);

      // 4. Verify result structure (isCached: false for fresh generation)
      expect(result).toEqual({
        query: dto.query,
        answer: 'Ingestion uses BullMQ [Source 1] and embeddings [Source 2].',
        sources: [
          {
            citation: '[Source 1]',
            documentTitle: 'Architecture Guide',
            chunkId: 'c-101',
            similarity: 0.91,
          },
          {
            citation: '[Source 2]',
            documentTitle: 'Embedding Pipeline',
            chunkId: 'c-102',
            similarity: 0.87,
          },
        ],
        isCached: false,
      });

      // 5. Verify result written to Redis with isCached: true and TTL 86400
      expect(redisMock.set).toHaveBeenCalledTimes(1);
      const [savedKey, savedPayloadStr, exFlag, ttl] =
        redisMock.set.mock.calls[0];
      expect(savedKey).toBe(expectedCacheKey);
      expect(exFlag).toBe('EX');
      expect(ttl).toBe(86400);

      const parsedSavedPayload = JSON.parse(savedPayloadStr as string);
      expect(parsedSavedPayload).toEqual({
        query: dto.query,
        answer: 'Ingestion uses BullMQ [Source 1] and embeddings [Source 2].',
        sources: [
          {
            citation: '[Source 1]',
            documentTitle: 'Architecture Guide',
            chunkId: 'c-101',
            similarity: 0.91,
          },
          {
            citation: '[Source 2]',
            documentTitle: 'Embedding Pipeline',
            chunkId: 'c-102',
            similarity: 0.87,
          },
        ],
        isCached: true,
      });
    });

    it('should return fallback answer when vector search returns no results', async () => {
      const dto: SearchQueryDto = { query: 'Quantum physics entanglement' };
      redisMock.get.mockResolvedValue(null);
      queryServiceMock.search.mockResolvedValue([]);

      const result = await service.askQuestion(dto);

      expect(result).toEqual({
        query: dto.query,
        answer: 'No matching documents found.',
        sources: [],
        isCached: false,
      });

      expect(openaiCreateMock).not.toHaveBeenCalled();
      expect(redisMock.set).not.toHaveBeenCalled();
    });
  });

  describe('Metric counters and histogram timers', () => {
    it('should properly increment queriesCounter on cache hit and cache miss', async () => {
      // 1. Cache hit
      redisMock.get.mockResolvedValueOnce(
        JSON.stringify({
          query: 'q1',
          answer: 'a1',
          sources: [],
          isCached: true,
        }),
      );
      await service.askQuestion({ query: 'q1' });
      expect(queriesCounterMock.inc).toHaveBeenCalledTimes(1);
      expect(cacheHitsCounterMock.inc).toHaveBeenCalledTimes(1);

      // 2. Cache miss
      redisMock.get.mockResolvedValueOnce(null);
      queryServiceMock.search.mockResolvedValueOnce([]);
      await service.askQuestion({ query: 'q2' });
      expect(queriesCounterMock.inc).toHaveBeenCalledTimes(2);
      expect(cacheHitsCounterMock.inc).toHaveBeenCalledTimes(1);
    });

    it('should start and stop generationTimer when calling OpenAI on cache miss', async () => {
      redisMock.get.mockResolvedValue(null);
      queryServiceMock.search.mockResolvedValue([
        {
          chunkId: 'c-1',
          content: 'Test content',
          similarity: 0.99,
          documentTitle: 'Test Doc',
          documentId: 'd-1',
        },
      ]);
      openaiCreateMock.mockResolvedValue({
        choices: [{ message: { content: 'Test answer' } }],
      });

      await service.askQuestion({ query: 'Test metric timing' });

      // Verify timer was started
      expect(generationTimerMock.startTimer).toHaveBeenCalledTimes(1);
      // Verify timer end function was called after OpenAI completed
      expect(endTimerMock).toHaveBeenCalledTimes(1);
    });
  });
});
