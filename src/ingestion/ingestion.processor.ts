/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Document, DocumentStatus } from '../documents/document.entity';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { ConfigService } from '@nestjs/config';
import { chunkText } from './chunking.util';

@Processor('ingestion')
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    @InjectRepository(Document)
    private documentRepo: Repository<Document>,
    private embeddingsService: EmbeddingsService,
    private configService: ConfigService,
    private dataSource: DataSource,
  ) {
    super(); // Required by WorkerHost
  }

  async process(job: Job<{ documentId: string }>): Promise<void> {
    const { documentId } = job.data;
    this.logger.log(`Starting ingestion for document: ${documentId}`);

    const document = await this.documentRepo.findOneBy({ id: documentId });
    if (!document) {
      this.logger.error(`Document ${documentId} not found in database.`);
      return;
    }

    try {
      // --- CHUNKING PHASE ---
      await this.updateStatus(documentId, DocumentStatus.CHUNKING);

      const chunkSize = this.configService.get<number>('chunking.size');
      const chunkOverlap = this.configService.get<number>('chunking.overlap');

      const chunks = chunkText(document.sourceContent, chunkSize, chunkOverlap);
      this.logger.log(
        `Document ${documentId} split into ${chunks.length} chunks.`,
      );

      // ---EMBEDDING PHASE ---
      await this.updateStatus(documentId, DocumentStatus.EMBEDDING);

      const BATCH_SIZE = 20;
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batchTexts = chunks.slice(i, i + BATCH_SIZE);

        // Fetch embeddings from OpenAI
        const embeddings = await this.embeddingsService.embedBatch(batchTexts);

        // --- STORAGE PHASE ---
        for (let j = 0; j < batchTexts.length; j++) {
          const chunkIndex = i + j;
          const content = batchTexts[j];
          const embeddingVector = embeddings[j];

          const pgVectorString = `[${embeddingVector.join(',')}]`;

          // Execute native parameterized query
          await this.dataSource.query(
            `INSERT INTO chunks ("documentId", "chunkIndex", "content", "embedding") 
             VALUES ($1, $2, $3, $4)`,
            [document.id, chunkIndex, content, pgVectorString],
          );
        }

        this.logger.log(
          `Processed batch ${Math.ceil((i + 1) / BATCH_SIZE)} for document ${documentId}`,
        );
      }

      // --- SUCCESS ---
      await this.updateStatus(documentId, DocumentStatus.READY);
      this.logger.log(`Successfully ingested document: ${documentId}`);
    } catch (error) {
      this.logger.error(
        `Failed to ingest document ${documentId}: ${error.message}`,
      );

      const maxAttempts = job.opts.attempts || 1;
      if (job.attemptsMade >= maxAttempts - 1) {
        await this.documentRepo.update(documentId, {
          status: DocumentStatus.FAILED,
          failureReason: error.message,
        });
      }

      throw error;
    }
  }

  private async updateStatus(id: string, status: DocumentStatus) {
    await this.documentRepo.update(id, { status });
  }
}
