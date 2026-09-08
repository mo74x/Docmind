/* eslint-disable @typescript-eslint/no-unsafe-member-access */
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
import { CircuitBreaker } from '../common/resilience/circuit-breaker';

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
  private readonly circuitBreaker: CircuitBreaker;

  constructor(
    private readonly configService: ConfigService,
    private readonly queryService: QueryService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
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
      apiKey:
        this.configService.get<string>('openai.apiKey') ||
        process.env.OPENAI_API_KEY ||
        'mock-key',
      timeout: 20000,
      maxRetries: 3,
    });
    this.model =
      this.configService.get<string>('openai.chatModel') || 'gpt-4o-mini';
    this.circuitBreaker = new CircuitBreaker({
      name: 'OpenAI-Chat',
      failureThreshold: 5,
      resetTimeoutMs: 30000,
    });
  }

  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  async askQuestion(
    dto: SearchQueryDto,
    workspaceId?: string | null,
  ): Promise<AnswerResponse> {
    const effectiveWorkspaceId = workspaceId ?? dto.workspaceId ?? null;
    this.queriesCounter.inc();
    const cacheKey = this.generateCacheKey(dto.query, effectiveWorkspaceId);
    const cachedResponse = await this.redis.get(cacheKey);

    if (cachedResponse) {
      this.logger.log(
        `Cache HIT for query: "${dto.query}" (workspace: ${effectiveWorkspaceId || 'global'})`,
      );
      this.cacheHitsCounter.inc();
      return JSON.parse(cachedResponse) as AnswerResponse;
    }

    this.logger.log(
      `Cache MISS for query: "${dto.query}" (workspace: ${effectiveWorkspaceId || 'global'}). Running pipeline...`,
    );

    const searchResults = await this.queryService.search(
      dto,
      effectiveWorkspaceId,
    );
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

    let answerText: string | null = null;
    let isDegraded = false;

    try {
      const response = await this.circuitBreaker.execute(() =>
        this.openai.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: dto.query },
          ],
          temperature: 0.1,
        }),
      );
      answerText = response.choices[0].message.content;
    } catch (llmError: any) {
      isDegraded = true;
      this.logger.error(
        `OpenAI LLM generation failed or circuit open: ${llmError?.message}. Falling back to retrieved excerpts.`,
      );
      answerText =
        'AI summary generation is temporarily degraded due to upstream LLM service latency. ' +
        'Here are the most relevant excerpts from your documents:\n\n' +
        searchResults
          .slice(0, 3)
          .map(
            (r, i) => `[Source ${i + 1}] (${r.documentTitle}):\n${r.content}`,
          )
          .join('\n\n');
    } finally {
      endTimer();
    }

    const finalResult = {
      query: dto.query,
      answer: answerText,
      sources: searchResults.map((res, i) => ({
        citation: `[Source ${i + 1}]`,
        documentTitle: res.documentTitle,
        chunkId: res.chunkId,
        similarity: res.similarity,
      })),
      isCached: false, // Flag to indicate a fresh generation
    };

    // Store successful non-degraded generation in Redis
    if (!isDegraded) {
      await this.redis.set(
        cacheKey,
        JSON.stringify({ ...finalResult, isCached: true }),
        'EX',
        this.CACHE_TTL,
      );
    }

    return finalResult;
  }

  /**
   * Stream RAG answer token-by-token via Server-Sent Events (SSE).
   */
  askQuestionStream(
    dto: SearchQueryDto,
    workspaceId?: string | null,
  ): Observable<MessageEvent> {
    const effectiveWorkspaceId = workspaceId ?? dto.workspaceId ?? null;
    return new Observable<MessageEvent>((subscriber) => {
      let isAborted = false;

      const runPipeline = async () => {
        this.queriesCounter.inc();
        const cacheKey = this.generateCacheKey(dto.query, effectiveWorkspaceId);
        const cachedResponse = await this.redis.get(cacheKey);

        if (cachedResponse) {
          this.logger.log(
            `Cache HIT (stream) for query: "${dto.query}" (workspace: ${effectiveWorkspaceId || 'global'})`,
          );
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
          `Cache MISS (stream) for query: "${dto.query}" (workspace: ${effectiveWorkspaceId || 'global'}). Running streaming pipeline...`,
        );

        const searchResults = await this.queryService.search(
          dto,
          effectiveWorkspaceId,
        );
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
  private generateCacheKey(query: string, workspaceId?: string | null): string {
    const normalized = query
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove all punctuation
      .replace(/\s+/g, ' ') // Collapse multiple spaces into one
      .trim();

    // Hash the normalized string to ensure a safe, fixed-length Redis key
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    const wsPrefix = workspaceId || 'global';
    return `docmind:cache:ask:${wsPrefix}:${hash}`;
  }
}
