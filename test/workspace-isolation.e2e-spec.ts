/* eslint-disable @typescript-eslint/no-unsafe-return */

/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WorkspacesService } from '../src/workspaces/workspaces.service';
import { DocumentsService } from '../src/documents/documents.service';
import { QueryService } from '../src/query/query.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ConfigService } from '@nestjs/config';

describe('Multi-Tenancy & Workspace Access Control (e2e)', () => {
  let app: INestApplication;

  const masterApiKey = 'super-admin-master-key-12345';
  const wsA = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Engineering',
    slug: 'engineering',
    apiKey: 'dcm_ws_engineering_key_aaa',
    createdAt: new Date(),
  };

  const wsB = {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Human Resources',
    slug: 'hr',
    apiKey: 'dcm_ws_hr_key_bbb',
    createdAt: new Date(),
  };

  const workspacesServiceMock = {
    createWorkspace: jest.fn(),
    findAll: jest.fn().mockResolvedValue([wsA, wsB]),
    findById: jest.fn(),
    findByApiKey: jest.fn().mockImplementation((key: string) => {
      if (key === wsA.apiKey) return Promise.resolve(wsA);
      if (key === wsB.apiKey) return Promise.resolve(wsB);
      return Promise.resolve(null);
    }),
    deleteWorkspace: jest.fn(),
  };

  const documentsServiceMock = {
    submitDocument: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
  };

  const queryServiceMock = {
    search: jest.fn(),
  };

  beforeAll(async () => {
    process.env.API_KEY = masterApiKey;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WorkspacesService)
      .useValue(workspacesServiceMock)
      .overrideProvider(DocumentsService)
      .useValue(documentsServiceMock)
      .overrideProvider(QueryService)
      .useValue(queryServiceMock)
      .overrideProvider(ConfigService)
      .useValue({
        get: jest.fn((key: string, defaultValue?: any) => {
          if (key === 'apiKey') return masterApiKey;
          return defaultValue;
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    delete process.env.API_KEY;
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Workspaces Management (/workspaces)', () => {
    it('POST /workspaces - should create workspace under Admin authorization', async () => {
      workspacesServiceMock.createWorkspace.mockResolvedValue(wsA);

      const res = await request(app.getHttpServer())
        .post('/workspaces')
        .set('x-api-key', masterApiKey)
        .send({ name: 'Engineering', slug: 'engineering' })
        .expect(201);

      expect(res.body.name).toBe('Engineering');
      expect(res.body.apiKey).toBe(wsA.apiKey);
    });

    it('GET /workspaces - should list workspaces for authenticated caller', async () => {
      const res = await request(app.getHttpServer())
        .get('/workspaces')
        .set('x-api-key', masterApiKey)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].slug).toBe('engineering');
    });
  });

  describe('Tenant Ingestion Isolation (/documents)', () => {
    it('POST /documents - should automatically bind document to Workspace A when using Workspace A apiKey', async () => {
      documentsServiceMock.submitDocument.mockResolvedValue({
        id: 'doc-eng-1',
        title: 'Backend Architecture',
        status: 'PENDING',
        workspaceId: wsA.id,
      });

      const res = await request(app.getHttpServer())
        .post('/documents')
        .set('x-api-key', wsA.apiKey)
        .send({
          title: 'Backend Architecture',
          content: 'Secret engineering architecture specifications.',
        })
        .expect(201);

      expect(res.body.workspaceId).toBe(wsA.id);
      expect(documentsServiceMock.submitDocument).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Backend Architecture' }),
        wsA.id,
      );
    });

    it('POST /documents - should automatically bind document to Workspace B when using Workspace B apiKey', async () => {
      documentsServiceMock.submitDocument.mockResolvedValue({
        id: 'doc-hr-1',
        title: 'Salary Ranges',
        status: 'PENDING',
        workspaceId: wsB.id,
      });

      const res = await request(app.getHttpServer())
        .post('/documents')
        .set('x-api-key', wsB.apiKey)
        .send({
          title: 'Salary Ranges',
          content: 'Confidential company salary and compensation tables.',
        })
        .expect(201);

      expect(res.body.workspaceId).toBe(wsB.id);
      expect(documentsServiceMock.submitDocument).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Salary Ranges' }),
        wsB.id,
      );
    });
  });

  describe('Tenant Retrieval Isolation (/query/search)', () => {
    it('POST /query/search - Workspace A caller only searches Workspace A partition', async () => {
      queryServiceMock.search.mockResolvedValue([
        {
          chunkId: 'chunk-eng',
          content: 'Engineering docs',
          similarity: 0.92,
          documentTitle: 'Backend Architecture',
          documentId: 'doc-eng-1',
        },
      ]);

      const res = await request(app.getHttpServer())
        .post('/query/search')
        .set('x-api-key', wsA.apiKey)
        .send({ query: 'What is the architecture?' })
        .expect(200);

      expect(res.body.workspaceId).toBe(wsA.id);
      expect(queryServiceMock.search).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'What is the architecture?' }),
        wsA.id,
      );
      expect(res.body.results[0].documentTitle).toBe('Backend Architecture');
    });

    it('POST /query/search - Workspace B caller only searches Workspace B partition', async () => {
      queryServiceMock.search.mockResolvedValue([
        {
          chunkId: 'chunk-hr',
          content: 'HR docs',
          similarity: 0.88,
          documentTitle: 'Salary Ranges',
          documentId: 'doc-hr-1',
        },
      ]);

      const res = await request(app.getHttpServer())
        .post('/query/search')
        .set('x-api-key', wsB.apiKey)
        .send({ query: 'Show me compensation' })
        .expect(200);

      expect(res.body.workspaceId).toBe(wsB.id);
      expect(queryServiceMock.search).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'Show me compensation' }),
        wsB.id,
      );
      expect(res.body.results[0].documentTitle).toBe('Salary Ranges');
    });

    it('POST /query/search - Super Admin without x-workspace-id searches global unpartitioned pool', async () => {
      queryServiceMock.search.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .post('/query/search')
        .set('x-api-key', masterApiKey)
        .send({ query: 'Global search across all documents' })
        .expect(200);

      expect(res.body.workspaceId).toBeNull();
      expect(queryServiceMock.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'Global search across all documents',
        }),
        null,
      );
    });

    it('POST /query/search - Super Admin can explicitly scope to any workspace with x-workspace-id', async () => {
      queryServiceMock.search.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .post('/query/search')
        .set('x-api-key', masterApiKey)
        .set('x-workspace-id', wsA.id)
        .send({ query: 'Scoped search as admin' })
        .expect(200);

      expect(res.body.workspaceId).toBe(wsA.id);
      expect(queryServiceMock.search).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'Scoped search as admin' }),
        wsA.id,
      );
    });
  });

  describe('Cross-Tenant Spoofing Prevention', () => {
    it('should reject Workspace A key attempting to access Workspace B via x-workspace-id with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post('/query/search')
        .set('x-api-key', wsA.apiKey)
        .set('x-workspace-id', wsB.id) // Spoof attempt
        .send({ query: 'Try reading Workspace B data' })
        .expect(403);

      expect(res.body.message).toContain('Workspace key does not have access');
      expect(queryServiceMock.search).not.toHaveBeenCalled();
    });

    it('should reject requests with invalid API key with 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .post('/query/search')
        .set('x-api-key', 'invalid-random-key')
        .send({ query: 'Unauthorized query' })
        .expect(401);
    });
  });
});
