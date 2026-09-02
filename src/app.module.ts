/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import configuration from './config/configuration';
import { Document } from './documents/document.entity';
import { Chunk } from './documents/chunk.entity';
import { EmbeddingsModule } from './embeddings/embeddings.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { DocumentsModule } from './documents/documents.module';
import { QueryModule } from './query/query.module';
import { RedisModule } from './redis/redis.module';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';

@Module({
  imports: [
    // Load Environment Variables
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    RedisModule,
    // Configure PostgreSQL
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('database.url'),
        entities: [Document, Chunk],
        synchronize: true,
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('redis.host'),
          port: configService.get<number>('redis.port'),
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.get<number>('rateLimit.ttl', 60000),
            limit: configService.get<number>('rateLimit.limit', 10),
          },
        ],
        storage: new ThrottlerStorageRedisService(
          new Redis({
            host: configService.get<string>('redis.host', 'localhost'),
            port: configService.get<number>('redis.port', 6379),
          }),
        ) as unknown as ThrottlerStorage,
      }),
    }),
    EmbeddingsModule,
    IngestionModule,
    DocumentsModule,
    QueryModule,
  ],
})
export class AppModule {}
