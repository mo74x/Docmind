import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Document } from './document.entity';
import { Chunk } from './chunk.entity';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { IngestionModule } from '../ingestion/ingestion.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, Chunk]),
    BullModule.registerQueue({
      name: 'ingestion',
    }),
    IngestionModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
