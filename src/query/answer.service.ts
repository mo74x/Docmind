import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { QueryService } from './query.service';
import { SearchQueryDto } from './dto/search-query.dto';

export interface AnswerSource {
  citation: string;
  documentTitle: string;
  chunkId: string;
  similarity: number;
}

export interface AnswerResponse {
  query: string;
  answer: string | null;
  sources: AnswerSource[];
  isCached?: boolean;
}

@Injectable()
export class AnswerService {
  private readonly openai: OpenAI;
  private readonly logger = new Logger(AnswerService.name);
  private readonly model: string;
  private readonly CACHE_TTL = 86400;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private configService: ConfigService,
    private queryService: QueryService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('openai.apiKey'),
    });
    this.model =
      this.configService.get<string>('openai.chatModel') || 'gpt-4o-mini';
  }

  async askQuestion(dto: SearchQueryDto): Promise<AnswerResponse> {
    const cacheKey = this.generateCacheKey(dto.query);

    // Check Redis for a cached answer
    const cachedResponse = await this.redis.get(cacheKey);
    if (cachedResponse) {
      this.logger.log(`Cache HIT for query: "${dto.query}"`);
      // Parse the JSON string back into an object
      return JSON.parse(cachedResponse) as AnswerResponse;
    }

    this.logger.log(
      `Cache MISS for query: "${dto.query}". Running pipeline...`,
    );

    // Run the standard RAG pipeline (Retrieval + OpenAI)
    const searchResults = await this.queryService.search(dto);

    if (!searchResults.length) {
      return {
        query: dto.query,
        answer: 'No matching documents found.',
        sources: [],
        isCached: false,
      };
    }

    const formattedContext = searchResults
      .map(
        (result, index) =>
          `[Source ${index + 1}] (Document: ${result.documentTitle}):\n${result.content}`,
      )
      .join('\n\n---\n\n');

    const systemPrompt = `You are a highly precise knowledge-base assistant. Answer the user's question using ONLY the provided sources below.\n\nRULES:\n1. Cite sources inline as [Source N].\n2. Do not hallucinate.\n\nSOURCES:\n${formattedContext}`;

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: dto.query },
      ],
      temperature: 0.1,
    });

    const finalResult = {
      query: dto.query,
      answer: response.choices[0].message.content,
      sources: searchResults.map((res, i) => ({
        citation: `[Source ${i + 1}]`,
        documentTitle: res.documentTitle,
        chunkId: res.chunkId,
        similarity: res.similarity,
      })),
      isCached: false, // Flag to indicate a fresh generation
    };

    // Store the successful generation in Redis
    // We set 'isCached' to true *only* in the version we save to Redis
    await this.redis.set(
      cacheKey,
      JSON.stringify({ ...finalResult, isCached: true }),
      'EX',
      this.CACHE_TTL,
    );

    return finalResult;
  }

  /**
   * Normalizes the string to handle "similar" phrasing constraints like
   * capitalization, extra spaces, and trailing punctuation.
   */
  private generateCacheKey(query: string): string {
    const normalized = query
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove all punctuation
      .replace(/\s+/g, ' ') // Collapse multiple spaces into one
      .trim();

    // Hash the normalized string to ensure a safe, fixed-length Redis key
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    return `docmind:cache:ask:${hash}`;
  }
}
