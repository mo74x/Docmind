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

  describe('GET /documents', () => {
    it('should return 200 OK with document list', async () => {
      const documentsList = [
        mockDocument,
        {
          ...mockDocument,
          id: 'b28795c6-455b-4c4c-a3f2-c38d38706fa2',
          title: 'Second Document',
          status: DocumentStatus.READY,
        },
      ];
      documentsServiceMock.findAll.mockResolvedValue(documentsList);

      const response = await request(app.getHttpServer())
        .get('/documents')
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].id).toBe(mockDocument.id);
      expect(documentsServiceMock.findAll).toHaveBeenCalledTimes(1);
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
