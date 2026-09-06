/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Response } from 'express';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let dataSourceMock: {
    query: jest.Mock;
  };
  let redisMock: {
    ping: jest.Mock;
  };

  const createMockResponse = () => {
    const res: Partial<Response> = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    return res as Response;
  };

  beforeEach(async () => {
    dataSourceMock = {
      query: jest.fn(),
    };
    redisMock = {
      ping: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DataSource, useValue: dataSourceMock },
        { provide: 'REDIS_CLIENT', useValue: redisMock },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkHealth', () => {
    it('should return 200 OK when DB and Redis are up', async () => {
      dataSourceMock.query.mockResolvedValue([{ '?column?': 1 }]);
      redisMock.ping.mockResolvedValue('PONG');
      const res = createMockResponse();

      await controller.checkHealth(res);

      expect(dataSourceMock.query).toHaveBeenCalledWith('SELECT 1');
      expect(redisMock.ping).toHaveBeenCalledTimes(1);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ok',
          services: expect.objectContaining({
            database: expect.objectContaining({
              status: 'up',
              latencyMs: expect.any(Number),
            }),
            redis: expect.objectContaining({
              status: 'up',
              latencyMs: expect.any(Number),
            }),
          }),
          memory: expect.objectContaining({
            heapUsedMb: expect.any(Number),
            heapTotalMb: expect.any(Number),
            rssMb: expect.any(Number),
          }),
          uptimeSeconds: expect.any(Number),
          responseTimeMs: expect.any(Number),
          timestamp: expect.any(String),
        }),
      );
    });

    it('should return 503 Service Unavailable when DB throws an error', async () => {
      const dbError = new Error('Database connection refused');
      dataSourceMock.query.mockRejectedValue(dbError);
      redisMock.ping.mockResolvedValue('PONG');
      const res = createMockResponse();

      await controller.checkHealth(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          services: expect.objectContaining({
            database: expect.objectContaining({
              status: 'down',
              error: 'Database connection refused',
              latencyMs: expect.any(Number),
            }),
            redis: expect.objectContaining({
              status: 'up',
              latencyMs: expect.any(Number),
            }),
          }),
        }),
      );
    });

    it('should return 503 Service Unavailable when Redis throws an error', async () => {
      const redisError = new Error('Redis connection timeout');
      dataSourceMock.query.mockResolvedValue([{ '?column?': 1 }]);
      redisMock.ping.mockRejectedValue(redisError);
      const res = createMockResponse();

      await controller.checkHealth(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          services: expect.objectContaining({
            database: expect.objectContaining({
              status: 'up',
              latencyMs: expect.any(Number),
            }),
            redis: expect.objectContaining({
              status: 'down',
              error: 'Redis connection timeout',
              latencyMs: expect.any(Number),
            }),
          }),
        }),
      );
    });

    it('should return 503 Service Unavailable when Redis returns an unexpected ping response', async () => {
      dataSourceMock.query.mockResolvedValue([{ '?column?': 1 }]);
      redisMock.ping.mockResolvedValue('LOADING');
      const res = createMockResponse();

      await controller.checkHealth(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          services: expect.objectContaining({
            database: expect.objectContaining({
              status: 'up',
            }),
            redis: expect.objectContaining({
              status: 'down',
              error: 'Unexpected ping response: LOADING',
            }),
          }),
        }),
      );
    });

    it('should return 503 Service Unavailable when both DB and Redis fail', async () => {
      dataSourceMock.query.mockRejectedValue(new Error('DB down'));
      redisMock.ping.mockRejectedValue(new Error('Redis down'));
      const res = createMockResponse();

      await controller.checkHealth(res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          services: expect.objectContaining({
            database: expect.objectContaining({
              status: 'down',
              error: 'DB down',
            }),
            redis: expect.objectContaining({
              status: 'down',
              error: 'Redis down',
            }),
          }),
        }),
      );
    });
  });
});
