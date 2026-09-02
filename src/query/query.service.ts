import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { SearchQueryDto } from './dto/search-query.dto';

export interface SearchResult {
  chunkId: string;
  content: string;
  similarity: number;
  documentTitle: string;
  documentId: string;
}

@Injectable()
export class QueryService {
  private readonly logger = new Logger(QueryService.name);

  constructor(
    private embeddingsService: EmbeddingsService,
    private dataSource: DataSource,
  ) {}

  async search(dto: SearchQueryDto): Promise<SearchResult[]> {
    this.logger.log(`Performing vector search for: "${dto.query}"`);
    const [queryVector] = await this.embeddingsService.embedBatch([dto.query]);
    const pgVectorString = `[${queryVector.join(',')}]`;
    const limit = dto.limit || 5;
    const results = await this.dataSource.query<SearchResult[]>(
      `SELECT 
         c.id AS "chunkId",
         c.content,
         1 - (c.embedding <-> $1) AS similarity,
         d.title AS "documentTitle",
         d.id AS "documentId"
       FROM chunks c
       JOIN documents d ON c."documentId" = d.id
       WHERE d.status = 'READY'
       ORDER BY c.embedding <-> $1
       LIMIT $2`,
      [pgVectorString, limit],
    );

    return results;
  }
}
