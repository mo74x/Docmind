/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Controller, Get, Inject, HttpStatus, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';

interface ServiceHealth {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Health check endpoint for database, redis, and system uptime',
  })
  @ApiResponse({
    status: 200,
    description: 'All system dependencies are healthy',
  })
  @ApiResponse({
    status: 503,
    description: 'One or more dependencies are unhealthy',
  })
  async checkHealth(@Res() res: Response) {
    const startTime = Date.now();
    const services: Record<string, ServiceHealth> = {};

    // 1. Check PostgreSQL database connectivity & latency
    const dbStart = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      services.database = {
        status: 'up',
        latencyMs: Date.now() - dbStart,
      };
    } catch (err: any) {
      services.database = {
        status: 'down',
        latencyMs: Date.now() - dbStart,
        error: err?.message || 'Database connection error',
      };
    }

    // 2. Check Redis connectivity & latency
    const redisStart = Date.now();
    try {
      const pingResponse = await this.redis.ping();
      if (pingResponse === 'PONG') {
        services.redis = {
          status: 'up',
          latencyMs: Date.now() - redisStart,
        };
      } else {
        services.redis = {
          status: 'down',
          latencyMs: Date.now() - redisStart,
          error: `Unexpected ping response: ${pingResponse}`,
        };
      }
    } catch (err: any) {
      services.redis = {
        status: 'down',
        latencyMs: Date.now() - redisStart,
        error: err?.message || 'Redis connection error',
      };
    }

    const allHealthy = Object.values(services).every(
      (service) => service.status === 'up',
    );

    const memory = process.memoryUsage();
    const payload = {
      status: allHealthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      responseTimeMs: Date.now() - startTime,
      memory: {
        heapUsedMb: Math.round((memory.heapUsed / 1024 / 1024) * 100) / 100,
        heapTotalMb: Math.round((memory.heapTotal / 1024 / 1024) * 100) / 100,
        rssMb: Math.round((memory.rss / 1024 / 1024) * 100) / 100,
      },
      services,
    };

    return res
      .status(allHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json(payload);
  }
}
