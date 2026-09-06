/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  NotFoundException,
} from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DocumentsService } from '../src/documents/documents.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { DocumentStatus } from '../src/documents/document.entity';

describe('DocumentsController (e2e)', () => {
  let app: INestApplication;
  const mockDocument = {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    title: 'DocMind Architecture Blueprint',
    sourceContent:
      'Enterprise-grade RAG pipeline with NestJS, BullMQ, and pgvector.',
    status: DocumentStatus.PENDING,
    failureReason: null,
    createdAt: new Date('2026-09-06T08:00:00.000Z'),
  };

  const documentsServiceMock = {
    submitDocument: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DocumentsService)
      .useValue(documentsServiceMock)
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
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /documents', () => {
    it('should successfully submit document and return 201 Created', async () => {
      documentsServiceMock.submitDocument.mockResolvedValue(mockDocument);

      const payload = {
        title: 'DocMind Architecture Blueprint',
        content:
          'Enterprise-grade RAG pipeline with NestJS, BullMQ, and pgvector.',
      };

      const response = await request(app.getHttpServer())
        .post('/documents')
        .send(payload)
        .expect(201);

      expect(response.body).toEqual({
        message: 'Document queued for ingestion',
        id: mockDocument.id,
        status: DocumentStatus.PENDING,
      });
      expect(documentsServiceMock.submitDocument).toHaveBeenCalledWith(payload);
    });

    it('should return 400 Bad Request when validation fails (missing content)', async () => {
      const invalidPayload = {
        title: 'Only Title Without Content',
      };

      const response = await request(app.getHttpServer())
        .post('/documents')
        .send(invalidPayload)
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.error).toBe('Bad Request');
      expect(Array.isArray(response.body.message)).toBe(true);
      expect(response.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('content')]),
      );
      expect(documentsServiceMock.submitDocument).not.toHaveBeenCalled();
    });

    it('should return 400 Bad Request when body is completely empty', async () => {
      const response = await request(app.getHttpServer())
        .post('/documents')
        .send({})
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.error).toBe('Bad Request');
      expect(Array.isArray(response.body.message)).toBe(true);
      expect(documentsServiceMock.submitDocument).not.toHaveBeenCalled();
    });
  });

  describe('POST /documents/upload', () => {
    it('should successfully upload a .txt file with custom title and return 201 Created', async () => {
      documentsServiceMock.submitDocument.mockResolvedValue(mockDocument);

      const fileBuffer = Buffer.from(
        'DocMind is an intelligent document RAG platform.',
      );

      const response = await request(app.getHttpServer())
        .post('/documents/upload')
        .field('title', 'Custom Uploaded Title')
        .attach('file', fileBuffer, 'sample.txt')
        .expect(201);

      expect(response.body).toEqual({
        message: 'Document uploaded and queued for ingestion',
        id: mockDocument.id,
        status: DocumentStatus.PENDING,
      });

      expect(documentsServiceMock.submitDocument).toHaveBeenCalledWith({
        title: 'Custom Uploaded Title',
        content: 'DocMind is an intelligent document RAG platform.',
      });
    });

    it('should default title to filename when title field is not provided', async () => {
      documentsServiceMock.submitDocument.mockResolvedValue(mockDocument);

      const fileBuffer = Buffer.from(
        'Plain text file content for RAG processing.',
      );

      const response = await request(app.getHttpServer())
        .post('/documents/upload')
        .attach('file', fileBuffer, 'docmind-overview.txt')
        .expect(201);

      expect(response.body).toEqual({
        message: 'Document uploaded and queued for ingestion',
        id: mockDocument.id,
        status: DocumentStatus.PENDING,
      });

      expect(documentsServiceMock.submitDocument).toHaveBeenCalledWith({
        title: 'docmind-overview',
        content: 'Plain text file content for RAG processing.',
      });
    });

    it('should return 400 Bad Request when no file is attached', async () => {
      const response = await request(app.getHttpServer())
        .post('/documents/upload')
        .field('title', 'No File Attached')
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toContain('File is required');
      expect(documentsServiceMock.submitDocument).not.toHaveBeenCalled();
    });

    it('should return 400 Bad Request when uploading an unsupported file format', async () => {
      const fileBuffer = Buffer.from('binary-content');

      const response = await request(app.getHttpServer())
        .post('/documents/upload')
        .attach('file', fileBuffer, 'executable.exe')
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toContain('Unsupported file format');
      expect(documentsServiceMock.submitDocument).not.toHaveBeenCalled();
    });

    it('should return 400 Bad Request when uploaded file is empty', async () => {
      const fileBuffer = Buffer.from('');

      const response = await request(app.getHttpServer())
        .post('/documents/upload')
        .attach('file', fileBuffer, 'empty.txt')
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toContain('Uploaded file is empty');
      expect(documentsServiceMock.submitDocument).not.toHaveBeenCalled();
    });
  });

  describe('GET /documents', () => {
    const paginatedResponse = {
      data: [mockDocument],
      meta: {
        page: 1,
        limit: 10,
        totalItems: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };

    it('should return 200 OK with paginated document response on default query', async () => {
      documentsServiceMock.findAll.mockResolvedValue(paginatedResponse);

      const response = await request(app.getHttpServer())
        .get('/documents')
        .expect(200);

      expect(response.body).toEqual({
        data: expect.any(Array),
        meta: {
          page: 1,
          limit: 10,
          totalItems: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });
      expect(response.body.data[0].id).toBe(mockDocument.id);
      expect(documentsServiceMock.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          limit: 10,
          order: 'DESC',
        }),
      );
    });

    it('should pass validated query parameters (page, limit, order) to service', async () => {
      const customResponse = {
        data: [mockDocument],
        meta: {
          page: 2,
          limit: 5,
          totalItems: 15,
          totalPages: 3,
          hasNextPage: true,
          hasPreviousPage: true,
        },
      };
      documentsServiceMock.findAll.mockResolvedValue(customResponse);

      const response = await request(app.getHttpServer())
        .get('/documents?page=2&limit=5&order=ASC')
        .expect(200);

      expect(response.body.meta.page).toBe(2);
      expect(response.body.meta.limit).toBe(5);
      expect(documentsServiceMock.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          limit: 5,
          order: 'ASC',
        }),
      );
    });

    it('should return 400 Bad Request when limit exceeds maximum of 100', async () => {
      const response = await request(app.getHttpServer())
        .get('/documents?limit=250')
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('limit')]),
      );
      expect(documentsServiceMock.findAll).not.toHaveBeenCalled();
    });

    it('should return 400 Bad Request when page is less than 1', async () => {
      const response = await request(app.getHttpServer())
        .get('/documents?page=0')
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('page')]),
      );
      expect(documentsServiceMock.findAll).not.toHaveBeenCalled();
    });

    it('should return 400 Bad Request when order is invalid', async () => {
      const response = await request(app.getHttpServer())
        .get('/documents?order=INVALID')
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('order')]),
      );
      expect(documentsServiceMock.findAll).not.toHaveBeenCalled();
    });
  });

  describe('GET /documents/:id', () => {
    it('should return 200 OK with document details when found', async () => {
      documentsServiceMock.findOne.mockResolvedValue(mockDocument);

      const response = await request(app.getHttpServer())
        .get(`/documents/${mockDocument.id}`)
        .expect(200);

      expect(response.body).toEqual({
        id: mockDocument.id,
        title: mockDocument.title,
        status: mockDocument.status,
        failureReason: mockDocument.failureReason,
        createdAt: mockDocument.createdAt.toISOString(),
      });
      expect(documentsServiceMock.findOne).toHaveBeenCalledWith(
        mockDocument.id,
      );
    });

    it('should return 404 Not Found via AllExceptionsFilter when document does not exist', async () => {
      const nonExistentId = 'non-existent-uuid';
      documentsServiceMock.findOne.mockRejectedValue(
        new NotFoundException(`Document with ID ${nonExistentId} not found`),
      );

      const response = await request(app.getHttpServer())
        .get(`/documents/${nonExistentId}`)
        .expect(404);

      expect(response.body).toEqual(
        expect.objectContaining({
          statusCode: 404,
          error: 'Not Found',
          message: `Document with ID ${nonExistentId} not found`,
          path: `/documents/${nonExistentId}`,
          method: 'GET',
        }),
      );
      expect(documentsServiceMock.findOne).toHaveBeenCalledWith(nonExistentId);
    });
  });

  describe('DELETE /documents/:id', () => {
    it('should return 200 OK when document and chunks are successfully removed', async () => {
      const deleteResult = {
        message: 'Document and associated chunks deleted successfully',
        id: mockDocument.id,
      };
      documentsServiceMock.remove.mockResolvedValue(deleteResult);

      const response = await request(app.getHttpServer())
        .delete(`/documents/${mockDocument.id}`)
        .expect(200);

      expect(response.body).toEqual(deleteResult);
      expect(documentsServiceMock.remove).toHaveBeenCalledWith(mockDocument.id);
    });

    it('should return 404 Not Found via AllExceptionsFilter when document to delete does not exist', async () => {
      const nonExistentId = 'non-existent-uuid';
      documentsServiceMock.remove.mockRejectedValue(
        new NotFoundException(`Document with ID ${nonExistentId} not found`),
      );

      const response = await request(app.getHttpServer())
        .delete(`/documents/${nonExistentId}`)
        .expect(404);

      expect(response.body).toEqual(
        expect.objectContaining({
          statusCode: 404,
          error: 'Not Found',
          message: `Document with ID ${nonExistentId} not found`,
          path: `/documents/${nonExistentId}`,
          method: 'DELETE',
        }),
      );
      expect(documentsServiceMock.remove).toHaveBeenCalledWith(nonExistentId);
    });
  });
});
