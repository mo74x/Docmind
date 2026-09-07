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

  /**
   * Search knowledge base routing to hybrid, dense vector, or full-text lexical retrieval based on mode.
   */
  async search(
    dto: SearchQueryDto,
    workspaceId?: string | null,
  ): Promise<SearchResult[]> {
    const effectiveWorkspaceId = workspaceId ?? dto.workspaceId ?? null;
    const mode = dto.mode || 'hybrid';
    switch (mode) {
      case 'vector':
        return this.vectorSearch(dto, effectiveWorkspaceId);
      case 'fts':
        return this.ftsSearch(dto, effectiveWorkspaceId);
      case 'hybrid':
      default:
        return this.hybridSearch(dto, effectiveWorkspaceId);
    }
  }

  /**
   * Hybrid Search: Combines pgvector cosine similarity with PostgreSQL tsvector using Reciprocal Rank Fusion (RRF).
   */
  async hybridSearch(
    dto: SearchQueryDto,
    workspaceId?: string | null,
  ): Promise<SearchResult[]> {
    const effectiveWorkspaceId = workspaceId ?? dto.workspaceId ?? null;
    this.logger.log(
      `Performing hybrid RRF search for: "${dto.query}" (workspace: ${effectiveWorkspaceId || 'global'})`,
    );
    const [queryVector] = await this.embeddingsService.embedBatch([dto.query]);
    const pgVectorString = `[${queryVector.join(',')}]`;
    const limit = dto.limit || 5;

    const results = await this.dataSource.query<SearchResult[]>(
      `WITH vector_matches AS (
         SELECT c.id, c.content, d.title AS "documentTitle", d.id AS "documentId",
                ROW_NUMBER() OVER (ORDER BY c.embedding <-> $1) AS rank_dense
         FROM chunks c
         JOIN documents d ON c."documentId" = d.id
         WHERE d.status = 'READY'
           AND ($4::uuid IS NULL OR c."workspaceId" = $4::uuid)
         ORDER BY c.embedding <-> $1
         LIMIT 20
       ),
       fts_matches AS (
         SELECT c.id, c.content, d.title AS "documentTitle", d.id AS "documentId",
                ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.tsv, plainto_tsquery('english', $2)) DESC) AS rank_fts
         FROM chunks c
         JOIN documents d ON c."documentId" = d.id
         WHERE d.status = 'READY'
           AND ($4::uuid IS NULL OR c."workspaceId" = $4::uuid)
           AND c.tsv @@ plainto_tsquery('english', $2)
         ORDER BY ts_rank_cd(c.tsv, plainto_tsquery('english', $2)) DESC
         LIMIT 20
       )
       SELECT 
         COALESCE(v.id, f.id) AS "chunkId",
         COALESCE(v.content, f.content) AS content,
         COALESCE(v."documentTitle", f."documentTitle") AS "documentTitle",
         COALESCE(v."documentId", f."documentId") AS "documentId",
         (COALESCE(1.0 / (60 + v.rank_dense), 0.0) + COALESCE(1.0 / (60 + f.rank_fts), 0.0))::float AS similarity
       FROM vector_matches v
       FULL OUTER JOIN fts_matches f ON v.id = f.id
       ORDER BY similarity DESC
       LIMIT $3`,
      [pgVectorString, dto.query, limit, effectiveWorkspaceId],
    );

    return results;
  }

  /**
   * Dense vector search using pgvector cosine distance operator (<->).
   */
  async vectorSearch(
    dto: SearchQueryDto,
    workspaceId?: string | null,
  ): Promise<SearchResult[]> {
    const effectiveWorkspaceId = workspaceId ?? dto.workspaceId ?? null;
    this.logger.log(
      `Performing dense vector search for: "${dto.query}" (workspace: ${effectiveWorkspaceId || 'global'})`,
    );
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
         AND ($3::uuid IS NULL OR c."workspaceId" = $3::uuid)
       ORDER BY c.embedding <-> $1
       LIMIT $2`,
      [pgVectorString, limit, effectiveWorkspaceId],
    );

    return results;
  }

  /**
   * Full-text lexical search using PostgreSQL tsvector and plainto_tsquery.
   */
  async ftsSearch(
    dto: SearchQueryDto,
    workspaceId?: string | null,
  ): Promise<SearchResult[]> {
    const effectiveWorkspaceId = workspaceId ?? dto.workspaceId ?? null;
    this.logger.log(
      `Performing full-text lexical search for: "${dto.query}" (workspace: ${effectiveWorkspaceId || 'global'})`,
    );
    const limit = dto.limit || 5;
    const results = await this.dataSource.query<SearchResult[]>(
      `SELECT 
         c.id AS "chunkId",
         c.content,
         ts_rank_cd(c.tsv, plainto_tsquery('english', $1))::float AS similarity,
         d.title AS "documentTitle",
         d.id AS "documentId"
       FROM chunks c
       JOIN documents d ON c."documentId" = d.id
       WHERE d.status = 'READY'
         AND ($3::uuid IS NULL OR c."workspaceId" = $3::uuid)
         AND c.tsv @@ plainto_tsquery('english', $1)
       ORDER BY similarity DESC
       LIMIT $2`,
      [dto.query, limit, effectiveWorkspaceId],
    );

    return results;
  }
}
