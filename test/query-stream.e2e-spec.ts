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
import { AnswerService } from '../src/query/answer.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { of } from 'rxjs';

describe('QueryController - Streaming RAG (e2e)', () => {
  let app: INestApplication;

  const answerServiceMock = {
    askQuestion: jest.fn(),
    askQuestionStream: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AnswerService)
      .useValue(answerServiceMock)
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
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/query/ask/stream', () => {
    it('should return 200 OK with text/event-stream and stream sources, tokens, and done event', async () => {
      const mockEvents = [
        {
          data: {
            type: 'sources',
            data: [
              {
                citation: '[Source 1]',
                documentTitle: 'System Overview',
                chunkId: 'chunk-1',
                similarity: 0.95,
              },
            ],
          },
        },
        {
          data: {
            type: 'token',
            content: 'DocMind ',
          },
        },
        {
          data: {
            type: 'token',
            content: 'streams real-time answers.',
          },
        },
        {
          data: {
            type: 'done',
            isCached: false,
          },
        },
      ];

      answerServiceMock.askQuestionStream.mockReturnValue(of(...mockEvents));

      const response = await request(app.getHttpServer())
        .get('/api/v1/query/ask/stream?query=What+is+DocMind&limit=3')
        .expect(200)
        .expect('Content-Type', /text\/event-stream/);

      expect(response.text).toContain(
        `data: ${JSON.stringify(mockEvents[0].data)}`,
      );
      expect(response.text).toContain(
        `data: ${JSON.stringify(mockEvents[1].data)}`,
      );
      expect(response.text).toContain(
        `data: ${JSON.stringify(mockEvents[2].data)}`,
      );
      expect(response.text).toContain(
        `data: ${JSON.stringify(mockEvents[3].data)}`,
      );

      expect(answerServiceMock.askQuestionStream).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'What is DocMind',
          limit: 3,
        }),
        null,
      );
    });

    it('should return 400 Bad Request via AllExceptionsFilter when query parameter is missing', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/query/ask/stream')
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('query')]),
      );
      expect(answerServiceMock.askQuestionStream).not.toHaveBeenCalled();
    });

    it('should return 400 Bad Request when limit is out of range', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/query/ask/stream?query=test&limit=99')
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('limit')]),
      );
      expect(answerServiceMock.askQuestionStream).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/query/ask/stream', () => {
    it('should return 200 OK with text/event-stream and stream responses from JSON body payload', async () => {
      const mockEvents = [
        {
          data: {
            type: 'sources',
            data: [],
          },
        },
        {
          data: {
            type: 'token',
            content: 'No matching documents found.',
          },
        },
        {
          data: {
            type: 'done',
            isCached: false,
          },
        },
      ];

      answerServiceMock.askQuestionStream.mockReturnValue(of(...mockEvents));

      const response = await request(app.getHttpServer())
        .post('/api/v1/query/ask/stream')
        .send({
          query: 'Non-existent topic query',
          limit: 5,
        })
        .expect(200)
        .expect('Content-Type', /text\/event-stream/);

      expect(response.text).toContain(
        `data: ${JSON.stringify(mockEvents[0].data)}`,
      );
      expect(response.text).toContain(
        `data: ${JSON.stringify(mockEvents[1].data)}`,
      );
      expect(response.text).toContain(
        `data: ${JSON.stringify(mockEvents[2].data)}`,
      );

      expect(answerServiceMock.askQuestionStream).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'Non-existent topic query',
          limit: 5,
        }),
        null,
      );
    });

    it('should return 400 Bad Request when POST body query is empty', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/query/ask/stream')
        .send({ query: '' })
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('query')]),
      );
      expect(answerServiceMock.askQuestionStream).not.toHaveBeenCalled();
    });
  });
});
