/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmbeddingsService } from './embeddings.service';

describe('EmbeddingsService', () => {
  let service: EmbeddingsService;
  let mockOpenAICreate: jest.Mock;

  beforeEach(async () => {
    mockOpenAICreate = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'openai.apiKey') return 'mock-openai-key';
              if (key === 'openai.embeddingModel')
                return 'text-embedding-3-small';
              if (key === 'openai.embeddingDimensions') return 1536;
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<EmbeddingsService>(EmbeddingsService);

    // Mock internal OpenAI embeddings create call
    (service as any).openai = {
      embeddings: {
        create: mockOpenAICreate,
      },
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return empty array if input array is empty without calling OpenAI', async () => {
    const result = await service.embedBatch([]);
    expect(result).toEqual([]);
    expect(mockOpenAICreate).not.toHaveBeenCalled();
  });

  it('should generate embeddings and sort them in original order by index', async () => {
    mockOpenAICreate.mockResolvedValue({
      data: [
        { index: 1, embedding: [0.3, 0.4] },
        { index: 0, embedding: [0.1, 0.2] },
      ],
    });

    const result = await service.embedBatch(['first chunk', 'second chunk']);

    expect(mockOpenAICreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['first chunk', 'second chunk'],
      dimensions: 1536,
    });
    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it('should throw an error with descriptive message when OpenAI fails', async () => {
    mockOpenAICreate.mockRejectedValue(new Error('Rate limit exceeded (429)'));

    await expect(service.embedBatch(['some text'])).rejects.toThrow(
      'Embedding failed: Rate limit exceeded (429)',
    );
  });

  it('should open circuit breaker after repeated failures', async () => {
    mockOpenAICreate.mockRejectedValue(new Error('OpenAI outage 503'));

    const breaker = service.getCircuitBreaker();

    // Trip the breaker (threshold = 5)
    for (let i = 0; i < 5; i++) {
      await expect(service.embedBatch(['text'])).rejects.toThrow();
    }

    expect(breaker.getState()).toBe('OPEN');

    // Next call fast-fails without hitting OpenAI API
    mockOpenAICreate.mockClear();
    await expect(service.embedBatch(['text'])).rejects.toThrow(
      /circuit breaker open/,
    );
    expect(mockOpenAICreate).not.toHaveBeenCalled();
  });
});
