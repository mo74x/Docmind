import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { QueryService, SearchResult } from './query.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { SearchQueryDto } from './dto/search-query.dto';

describe('QueryService', () => {
  let service: QueryService;
  let embeddingsServiceMock: {
    embedBatch: jest.Mock;
  };
  let dataSourceMock: {
    query: jest.Mock;
  };

  beforeEach(async () => {
    embeddingsServiceMock = {
      embedBatch: jest.fn(),
    };
    dataSourceMock = {
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryService,
        { provide: EmbeddingsService, useValue: embeddingsServiceMock },
        { provide: DataSource, useValue: dataSourceMock },
      ],
    }).compile();

    service = module.get<QueryService>(QueryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('hybridSearch (Default Search Mode)', () => {
    it('should execute CTE combining vector search and FTS with Reciprocal Rank Fusion (RRF) and tenant isolation', async () => {
      const mockVector = [0.123, -0.456, 0.789, 0.0];
      embeddingsServiceMock.embedBatch.mockResolvedValue([mockVector]);

      const mockResults: SearchResult[] = [
        {
          chunkId: 'chunk-1',
          content: 'DocMind hybrid retrieval combines dense and lexical search',
          similarity: 0.0327, // RRF score
          documentTitle: 'Architecture Overview',
          documentId: 'doc-1',
        },
      ];
      dataSourceMock.query.mockResolvedValue(mockResults);

      const dto: SearchQueryDto = {
        query: 'What is hybrid search?',
        limit: 3,
        workspaceId: 'ws-tenant-1',
      };

      const results = await service.search(dto);

      expect(embeddingsServiceMock.embedBatch).toHaveBeenCalledTimes(1);
      expect(embeddingsServiceMock.embedBatch).toHaveBeenCalledWith([
        dto.query,
      ]);

      expect(dataSourceMock.query).toHaveBeenCalledTimes(1);
      const [sqlQuery, sqlParams] = dataSourceMock.query.mock.calls[0] as [
        string,
        unknown[],
      ];

      // Verify CTE vector_matches and fts_matches
      expect(sqlQuery).toContain('WITH vector_matches AS');
      expect(sqlQuery).toContain('c.embedding <-> $1');
      expect(sqlQuery).toContain('fts_matches AS');
      expect(sqlQuery).toContain("plainto_tsquery('english', $2)");
      expect(sqlQuery).toContain('FULL OUTER JOIN fts_matches');
      expect(sqlQuery).toContain('1.0 / (60 + v.rank_dense)');
      expect(sqlQuery).toContain('1.0 / (60 + f.rank_fts)');
      expect(sqlQuery).toContain('LIMIT $3');
      expect(sqlQuery).toContain(
        '($4::uuid IS NULL OR c."workspaceId" = $4::uuid)',
      );

      // Verify SQL params: [$1 pgVector, $2 query string, $3 limit, $4 workspaceId]
      const expectedPgVector = `[${mockVector.join(',')}]`;
      expect(sqlParams).toEqual([
        expectedPgVector,
        dto.query,
        3,
        'ws-tenant-1',
      ]);

      expect(results).toEqual(mockResults);
    });

    it('should pass null workspaceId when unpartitioned', async () => {
      embeddingsServiceMock.embedBatch.mockResolvedValue([[0.1, 0.2]]);
      dataSourceMock.query.mockResolvedValue([]);

      const dto: SearchQueryDto = {
        query: 'unlimited query',
      };

      await service.search(dto);

      const [, sqlParams] = dataSourceMock.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sqlParams[2]).toBe(5);
      expect(sqlParams[3]).toBeNull();
    });
  });

  describe('vectorSearch (mode: vector)', () => {
    it('should execute pure dense vector search with workspace partition filter', async () => {
      const mockVector = [0.5, -0.5, 0.25];
      embeddingsServiceMock.embedBatch.mockResolvedValue([mockVector]);

      const mockResults: SearchResult[] = [
        {
          chunkId: 'chunk-vector',
          content: 'Dense vector content',
          similarity: 0.94,
          documentTitle: 'Vector Guide',
          documentId: 'doc-v',
        },
      ];
      dataSourceMock.query.mockResolvedValue(mockResults);

      const dto: SearchQueryDto = {
        query: 'dense vector query',
        limit: 10,
        mode: 'vector',
        workspaceId: 'ws-partition-77',
      };

      const results = await service.search(dto);

      expect(embeddingsServiceMock.embedBatch).toHaveBeenCalledTimes(1);
      expect(dataSourceMock.query).toHaveBeenCalledTimes(1);

      const [sqlQuery, sqlParams] = dataSourceMock.query.mock.calls[0] as [
        string,
        unknown[],
      ];

      expect(sqlQuery).toContain('1 - (c.embedding <-> $1) AS similarity');
      expect(sqlQuery).toContain(
        '($3::uuid IS NULL OR c."workspaceId" = $3::uuid)',
      );
      expect(sqlQuery).toContain('ORDER BY c.embedding <-> $1');
      expect(sqlQuery).toContain('LIMIT $2');
      expect(sqlParams).toEqual([
        `[${mockVector.join(',')}]`,
        10,
        'ws-partition-77',
      ]);
      expect(results).toEqual(mockResults);
    });
  });

  describe('ftsSearch (mode: fts)', () => {
    it('should execute pure full-text search with workspace partition filter', async () => {
      const mockResults: SearchResult[] = [
        {
          chunkId: 'chunk-fts',
          content:
            'Lexical exact keyword match for error ERR_CONNECTION_REFUSED',
          similarity: 0.85,
          documentTitle: 'Troubleshooting Guide',
          documentId: 'doc-fts',
        },
      ];
      dataSourceMock.query.mockResolvedValue(mockResults);

      const dto: SearchQueryDto = {
        query: 'ERR_CONNECTION_REFUSED',
        limit: 4,
        mode: 'fts',
        workspaceId: 'ws-partition-88',
      };

      const results = await service.search(dto);

      // Embedding service should NOT be called for pure FTS
      expect(embeddingsServiceMock.embedBatch).not.toHaveBeenCalled();
      expect(dataSourceMock.query).toHaveBeenCalledTimes(1);

      const [sqlQuery, sqlParams] = dataSourceMock.query.mock.calls[0] as [
        string,
        unknown[],
      ];

      expect(sqlQuery).toContain(
        "ts_rank_cd(c.tsv, plainto_tsquery('english', $1))::float AS similarity",
      );
      expect(sqlQuery).toContain(
        '($3::uuid IS NULL OR c."workspaceId" = $3::uuid)',
      );
      expect(sqlQuery).toContain("c.tsv @@ plainto_tsquery('english', $1)");
      expect(sqlQuery).toContain('ORDER BY similarity DESC');
      expect(sqlQuery).toContain('LIMIT $2');
      expect(sqlParams).toEqual([dto.query, 4, 'ws-partition-88']);
      expect(results).toEqual(mockResults);
    });
  });

  describe('Edge cases', () => {
    it('should correctly format negative and high-precision embeddings', async () => {
      const mockVector = [-0.012345, 0.987654, -1.0, 0.5555];
      embeddingsServiceMock.embedBatch.mockResolvedValue([mockVector]);
      dataSourceMock.query.mockResolvedValue([]);

      const dto: SearchQueryDto = {
        query: 'precision test',
        limit: 10,
        mode: 'hybrid',
      };

      await service.search(dto);

      const [, sqlParams] = dataSourceMock.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sqlParams[0]).toBe('[-0.012345,0.987654,-1,0.5555]');
      expect(sqlParams[1]).toBe(dto.query);
      expect(sqlParams[2]).toBe(10);
      expect(sqlParams[3]).toBeNull();
    });

    it('should return empty array when no matching documents are found', async () => {
      embeddingsServiceMock.embedBatch.mockResolvedValue([[0.1, 0.2]]);
      dataSourceMock.query.mockResolvedValue([]);

      const results = await service.search({ query: 'non-existent query' });

      expect(results).toEqual([]);
    });
  });
});
