import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import compression from 'compression';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(
      compression({
        threshold: 1024,
        filter: (req, res) => {
          if (req.headers['accept'] === 'text/event-stream') {
            return false;
          }
          return compression.filter(req, res);
        },
      }),
    );
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

  it('/ (GET) returns 200 with Hello World!', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/ (GET) serves uncompressed response for small payloads under threshold', async () => {
    const res = await request(app.getHttpServer())
      .get('/')
      .set('Accept-Encoding', 'gzip');

    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('bypasses compression when Accept header is text/event-stream', async () => {
    const res = await request(app.getHttpServer())
      .get('/')
      .set('Accept', 'text/event-stream')
      .set('Accept-Encoding', 'gzip');

    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('/non-existent-route (GET) returns 404 formatted by AllExceptionsFilter', () => {
    return request(app.getHttpServer())
      .get('/non-existent-route')
      .expect(404)
      .expect((res) => {
        expect(res.body).toEqual(
          expect.objectContaining({
            statusCode: 404,
            error: 'Not Found',
            path: '/non-existent-route',
            method: 'GET',
          }),
        );
      });
  });
});
