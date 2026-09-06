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

  describe('search', () => {
    it('should format query embeddings into pgvector format and execute raw SQL with cosine distance operator', async () => {
      const mockVector = [0.123, -0.456, 0.789, 0.0];
      embeddingsServiceMock.embedBatch.mockResolvedValue([mockVector]);

      const mockResults: SearchResult[] = [
        {
          chunkId: 'chunk-1',
          content: 'Relevant content snippet 1',
          similarity: 0.92,
          documentTitle: 'System Design Doc',
          documentId: 'doc-1',
        },
      ];
      dataSourceMock.query.mockResolvedValue(mockResults);

      const dto: SearchQueryDto = {
        query: 'What is the system architecture?',
        limit: 3,
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

      // Verifies cosine distance operator <-> and READY status filter in query
      expect(sqlQuery).toContain('c.embedding <-> $1');
      expect(sqlQuery).toContain("WHERE d.status = 'READY'");
      expect(sqlQuery).toContain('ORDER BY c.embedding <-> $1');
      expect(sqlQuery).toContain('LIMIT $2');

      // Verifies pgvector format [0.123,-0.456,0.789,0]
      const expectedPgVector = `[${mockVector.join(',')}]`;
      expect(sqlParams).toEqual([expectedPgVector, 3]);

      expect(results).toEqual(mockResults);
    });

    it('should apply default limit of 5 when limit is not specified', async () => {
      const mockVector = [0.1, 0.2, 0.3];
      embeddingsServiceMock.embedBatch.mockResolvedValue([mockVector]);
      dataSourceMock.query.mockResolvedValue([]);

      const dto: SearchQueryDto = {
        query: 'test query without limit',
      };

      const results = await service.search(dto);

      expect(dataSourceMock.query).toHaveBeenCalledTimes(1);
      const [, sqlParams] = dataSourceMock.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sqlParams[1]).toBe(5);
      expect(results).toEqual([]);
    });

    it('should correctly format multi-dimensional and negative embeddings', async () => {
      const mockVector = [-0.012345, 0.987654, -1.0, 0.5555];
      embeddingsServiceMock.embedBatch.mockResolvedValue([mockVector]);
      dataSourceMock.query.mockResolvedValue([]);

      const dto: SearchQueryDto = {
        query: 'negative embeddings test',
        limit: 10,
      };

      await service.search(dto);

      const [, sqlParams] = dataSourceMock.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sqlParams[0]).toBe('[-0.012345,0.987654,-1,0.5555]');
      expect(sqlParams[1]).toBe(10);
    });

    it('should return empty array when no matching documents are found', async () => {
      embeddingsServiceMock.embedBatch.mockResolvedValue([[0.1, 0.2]]);
      dataSourceMock.query.mockResolvedValue([]);

      const results = await service.search({ query: 'non-existent query' });

      expect(results).toEqual([]);
    });
  });
});
