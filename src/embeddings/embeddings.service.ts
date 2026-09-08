/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { CircuitBreaker } from '../common/resilience/circuit-breaker';

@Injectable()
export class EmbeddingsService {
  private readonly openai: OpenAI;
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly model: string;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(private configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey:
        this.configService.get<string>('openai.apiKey') ||
        process.env.OPENAI_API_KEY ||
        'mock-key',
      timeout: 20000,
      maxRetries: 3,
    });
    this.model =
      this.configService.get<string>('openai.embeddingModel') ||
      'text-embedding-3-small';
    this.circuitBreaker = new CircuitBreaker({
      name: 'OpenAI-Embeddings',
      failureThreshold: 5,
      resetTimeoutMs: 30000,
    });
  }

  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  // Takes an array of text chunks and returns an array of vector embeddings.
  // OpenAI supports arrays of strings natively up to a token limit.

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];

    try {
      return await this.circuitBreaker.execute(async () => {
        const response = await this.openai.embeddings.create({
          model: this.model,
          input: texts,
          dimensions: this.configService.get<number>(
            'openai.embeddingDimensions',
          ),
        });

        // Map the response data back to a simple array of number arrays
        // Sorting by index ensures they match the exact order of the input texts
        return response.data
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding);
      });
    } catch (error) {
      this.logger.error(
        `Failed to generate embeddings: ${error.message}`,
        error.stack,
      );
      throw new Error(`Embedding failed: ${error.message}`);
    }
  }
}
