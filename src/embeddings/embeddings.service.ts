/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingsService {
  private readonly openai: OpenAI;
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly model: string;

  constructor(private configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('openai.apiKey'),
    });
    this.model =
      this.configService.get<string>('openai.embeddingModel') ||
      'text-embedding-3-small';
  }

  // Takes an array of text chunks and returns an array of vector embeddings.
  // OpenAI supports arrays of strings natively up to a token limit.

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];

    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: texts,
        // dimensions parameter is supported on newer models (text-embedding-3-small/large)
        dimensions: this.configService.get<number>(
          'openai.embeddingDimensions',
        ),
      });

      // Map the response data back to a simple array of number arrays
      // Sorting by index ensures they match the exact order of the input texts
      return response.data
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);
    } catch (error) {
      this.logger.error(
        `Failed to generate embeddings: ${error.message}`,
        error.stack,
      );
      throw new Error(`Embedding failed: ${error.message}`);
    }
  }
}
