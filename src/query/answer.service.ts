import { Injectable, Logger, Inject, MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { Observable } from 'rxjs';
import { QueryService } from './query.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Histogram, Counter } from 'prom-client';

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

export interface StreamSourcesEvent {
  type: 'sources';
  data: AnswerSource[];
}

export interface StreamTokenEvent {
  type: 'token';
  content: string;
}

export interface StreamDoneEvent {
  type: 'done';
  isCached: boolean;
}

export type StreamEventData =
  StreamSourcesEvent | StreamTokenEvent | StreamDoneEvent;

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
    @InjectMetric('rag_queries_total')
    private readonly queriesCounter: Counter<string>,
    @InjectMetric('rag_cache_hits_total')
    private readonly cacheHitsCounter: Counter<string>,
    @InjectMetric('llm_generation_duration_seconds')
    private readonly generationTimer: Histogram<string>,
    @InjectMetric('vector_search_latency_seconds')
    private readonly vectorSearchTimer: Histogram<string>,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('openai.apiKey'),
    });
    this.model =
      this.configService.get<string>('openai.chatModel') || 'gpt-4o-mini';
  }

  async askQuestion(dto: SearchQueryDto): Promise<AnswerResponse> {
    this.queriesCounter.inc();
    const cacheKey = this.generateCacheKey(dto.query);
    const cachedResponse = await this.redis.get(cacheKey);

    if (cachedResponse) {
      this.logger.log(`Cache HIT for query: "${dto.query}"`);
      this.cacheHitsCounter.inc();
      return JSON.parse(cachedResponse) as AnswerResponse;
    }

    this.logger.log(
      `Cache MISS for query: "${dto.query}". Running pipeline...`,
    );

    const searchResults = await this.queryService.search(dto);
    const endTimer = this.generationTimer.startTimer();

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
    endTimer();

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
   * Stream RAG answer token-by-token via Server-Sent Events (SSE).
   */
  askQuestionStream(dto: SearchQueryDto): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let isAborted = false;

      const runPipeline = async () => {
        this.queriesCounter.inc();
        const cacheKey = this.generateCacheKey(dto.query);
        const cachedResponse = await this.redis.get(cacheKey);

        if (cachedResponse) {
          this.logger.log(`Cache HIT (stream) for query: "${dto.query}"`);
          this.cacheHitsCounter.inc();
          const parsed = JSON.parse(cachedResponse) as AnswerResponse;

          subscriber.next({
            data: {
              type: 'sources',
              data: parsed.sources,
            },
          });

          subscriber.next({
            data: {
              type: 'token',
              content: parsed.answer || '',
            },
          });

          subscriber.next({
            data: {
              type: 'done',
              isCached: true,
            },
          });

          subscriber.complete();
          return;
        }

        this.logger.log(
          `Cache MISS (stream) for query: "${dto.query}". Running streaming pipeline...`,
        );

        const searchResults = await this.queryService.search(dto);
        const endTimer = this.generationTimer.startTimer();

        if (isAborted) {
          endTimer();
          return;
        }

        const formattedSources: AnswerSource[] = searchResults.map(
          (res, i) => ({
            citation: `[Source ${i + 1}]`,
            documentTitle: res.documentTitle,
            chunkId: res.chunkId,
            similarity: res.similarity,
          }),
        );

        // Emit initial sources event
        subscriber.next({
          data: {
            type: 'sources',
            data: formattedSources,
          },
        });

        if (!searchResults.length) {
          subscriber.next({
            data: {
              type: 'token',
              content: 'No matching documents found.',
            },
          });
          subscriber.next({
            data: {
              type: 'done',
              isCached: false,
            },
          });
          endTimer();
          subscriber.complete();
          return;
        }

        const formattedContext = searchResults
          .map(
            (result, index) =>
              `[Source ${index + 1}] (Document: ${result.documentTitle}):\n${result.content}`,
          )
          .join('\n\n---\n\n');

        const systemPrompt = `You are a highly precise knowledge-base assistant. Answer the user's question using ONLY the provided sources below.\n\nRULES:\n1. Cite sources inline as [Source N].\n2. Do not hallucinate.\n\nSOURCES:\n${formattedContext}`;

        try {
          const stream = await this.openai.chat.completions.create({
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: dto.query },
            ],
            temperature: 0.1,
            stream: true,
          });

          let fullAnswer = '';

          for await (const chunk of stream) {
            if (isAborted) break;
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              fullAnswer += content;
              subscriber.next({
                data: {
                  type: 'token',
                  content,
                },
              });
            }
          }

          if (!isAborted) {
            endTimer();

            // Store full answer in Redis cache
            const cachePayload: AnswerResponse = {
              query: dto.query,
              answer: fullAnswer,
              sources: formattedSources,
              isCached: true,
            };

            await this.redis.set(
              cacheKey,
              JSON.stringify(cachePayload),
              'EX',
              this.CACHE_TTL,
            );

            subscriber.next({
              data: {
                type: 'done',
                isCached: false,
              },
            });

            subscriber.complete();
          }
        } catch (error) {
          endTimer();
          subscriber.error(error);
        }
      };

      runPipeline().catch((err) => {
        subscriber.error(err);
      });

      return () => {
        isAborted = true;
      };
    });
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
