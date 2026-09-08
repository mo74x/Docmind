import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Document } from '../documents/document.entity';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { IngestionProcessor } from './ingestion.processor';
import { IngestionEventsService } from './ingestion-events.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document]),
    BullModule.registerQueue({
      name: 'ingestion',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 100, age: 86400 },
        removeOnFail: false, // Retain failed jobs in BullMQ failed set (DLQ)
      },
    }),
    EmbeddingsModule,
  ],
  providers: [IngestionProcessor, IngestionEventsService],
  exports: [BullModule, IngestionEventsService],
})
export class IngestionModule {}
