/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ChatService } from '../src/chat/chat.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { of } from 'rxjs';

describe('ChatController - Conversational Memory (e2e)', () => {
  let app: INestApplication;

  const chatServiceMock = {
    createSession: jest.fn(),
    listSessions: jest.fn(),
    getSessionWithMessages: jest.fn(),
    listMessages: jest.fn(),
    deleteSession: jest.fn(),
    sendMessage: jest.fn(),
    sendMessageStream: jest.fn(),
  };

  const sampleSessionId = '11111111-2222-3333-4444-555555555555';

  beforeAll(async () => {
    process.env.API_KEY = 'test-api-key';
    process.env.OPENAI_API_KEY = 'test-mock-key';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ChatService)
      .useValue(chatServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api', {
      exclude: ['/', 'health', 'metrics'],
    });
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    await app.init();
  });

  afterAll(async () => {
    delete process.env.API_KEY;
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/chat/sessions', () => {
    it('should create a new session and return 201 Created', async () => {
      chatServiceMock.createSession.mockResolvedValue({
        id: sampleSessionId,
        title: 'DocMind Discussion',
        workspaceId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/sessions')
        .set('x-api-key', 'test-api-key')
        .send({ title: 'DocMind Discussion' })
        .expect(201);

      expect(response.body.id).toBe(sampleSessionId);
      expect(response.body.title).toBe('DocMind Discussion');
      expect(chatServiceMock.createSession).toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/chat/sessions', () => {
    it('should return 200 OK with paginated sessions', async () => {
      chatServiceMock.listSessions.mockResolvedValue({
        data: [
          {
            id: sampleSessionId,
            title: 'DocMind Discussion',
          },
        ],
        meta: {
          page: 1,
          limit: 10,
          totalItems: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/chat/sessions?page=1&limit=10')
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta.totalItems).toBe(1);
    });
  });

  describe('GET /api/v1/chat/sessions/:id', () => {
    it('should return 200 OK with session and messages', async () => {
      chatServiceMock.getSessionWithMessages.mockResolvedValue({
        id: sampleSessionId,
        title: 'DocMind Discussion',
        messages: [
          { id: 'm1', role: 'user', content: 'What is DocMind?' },
          { id: 'm2', role: 'assistant', content: 'A RAG platform.' },
        ],
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/chat/sessions/${sampleSessionId}`)
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(response.body.id).toBe(sampleSessionId);
      expect(response.body.messages).toHaveLength(2);
    });

    it('should support pagination query params', async () => {
      chatServiceMock.getSessionWithMessages.mockResolvedValue({
        id: sampleSessionId,
        title: 'DocMind Discussion',
        messages: [{ id: 'm1', role: 'user', content: 'What is DocMind?' }],
        messagesMeta: {
          page: 1,
          limit: 1,
          totalItems: 2,
          totalPages: 2,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      });

      const response = await request(app.getHttpServer())
        .get(
          `/api/v1/chat/sessions/${sampleSessionId}?page=1&limit=1&order=ASC`,
        )
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(response.body.id).toBe(sampleSessionId);
      expect(response.body.messages).toHaveLength(1);
      expect(response.body.messagesMeta.totalItems).toBe(2);
      expect(chatServiceMock.getSessionWithMessages).toHaveBeenCalled();
    });

    it('should return 400 when session id is not a valid UUID', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/chat/sessions/invalid-not-uuid')
        .set('x-api-key', 'test-api-key')
        .expect(400);
    });
  });

  describe('GET /api/v1/chat/sessions/:id/messages', () => {
    it('should return 200 OK with paginated messages', async () => {
      chatServiceMock.listMessages.mockResolvedValue({
        data: [{ id: 'm1', role: 'user', content: 'What is DocMind?' }],
        meta: {
          page: 1,
          limit: 10,
          totalItems: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const response = await request(app.getHttpServer())
        .get(
          `/api/v1/chat/sessions/${sampleSessionId}/messages?page=1&limit=10&order=ASC`,
        )
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta.totalItems).toBe(1);
      expect(chatServiceMock.listMessages).toHaveBeenCalled();
    });

    it('should return 400 when session id is not a valid UUID', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/chat/sessions/invalid-not-uuid/messages')
        .set('x-api-key', 'test-api-key')
        .expect(400);
    });
  });

  describe('POST /api/v1/chat/sessions/:id/messages', () => {
    it('should send a message and return assistant answer with citations and standaloneQuery', async () => {
      chatServiceMock.sendMessage.mockResolvedValue({
        sessionId: sampleSessionId,
        userMessage: {
          id: 'u1',
          sessionId: sampleSessionId,
          role: 'user',
          content: 'What is its chunk size?',
        },
        assistantMessage: {
          id: 'a1',
          sessionId: sampleSessionId,
          role: 'assistant',
          content: 'The default chunk size is 800 characters [Source 1].',
          sources: [
            {
              citation: '[Source 1]',
              documentTitle: 'Ingestion Guide',
              chunkId: 'c1',
              similarity: 0.92,
            },
          ],
        },
        sources: [
          {
            citation: '[Source 1]',
            documentTitle: 'Ingestion Guide',
            chunkId: 'c1',
            similarity: 0.92,
          },
        ],
        standaloneQuery: 'What is the default chunk size in DocMind?',
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/chat/sessions/${sampleSessionId}/messages`)
        .set('x-api-key', 'test-api-key')
        .send({
          content: 'What is its chunk size?',
          mode: 'hybrid',
          limit: 3,
        })
        .expect(200);

      expect(response.body.sessionId).toBe(sampleSessionId);
      expect(response.body.standaloneQuery).toBe(
        'What is the default chunk size in DocMind?',
      );
      expect(response.body.assistantMessage.content).toContain('[Source 1]');
      expect(response.body.sources).toHaveLength(1);
    });

    it('should return 400 if content is missing or empty', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/chat/sessions/${sampleSessionId}/messages`)
        .set('x-api-key', 'test-api-key')
        .send({ content: '' })
        .expect(400);
    });
  });

  describe('GET /api/v1/chat/sessions/:id/messages/stream', () => {
    it('should return 200 OK with text/event-stream headers and stream SSE events', async () => {
      const mockEvents = [
        {
          data: {
            type: 'sources',
            data: [
              {
                citation: '[Source 1]',
                documentTitle: 'DocMind Specs',
                chunkId: 'c-1',
                similarity: 0.94,
              },
            ],
            standaloneQuery: 'What is DocMind?',
          },
        },
        {
          data: {
            type: 'token',
            content: 'DocMind is awesome.',
          },
        },
        {
          data: {
            type: 'done',
            messageId: 'a-done-id',
            role: 'assistant',
          },
        },
      ];

      chatServiceMock.sendMessageStream.mockReturnValue(of(...mockEvents));

      const response = await request(app.getHttpServer())
        .get(
          `/api/v1/chat/sessions/${sampleSessionId}/messages/stream?content=Tell%20me%20about%20DocMind`,
        )
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.text).toContain('"type":"sources"');
      expect(response.text).toContain('DocMind is awesome.');
      expect(response.text).toContain('"type":"done"');
    });
  });

  describe('DELETE /api/v1/chat/sessions/:id', () => {
    it('should delete session and return 200 OK', async () => {
      chatServiceMock.deleteSession.mockResolvedValue(undefined);

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/chat/sessions/${sampleSessionId}`)
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(response.body.message).toBe('Chat session deleted successfully');
      expect(chatServiceMock.deleteSession).toHaveBeenCalledWith(
        sampleSessionId,
        null,
      );
    });
  });
});
