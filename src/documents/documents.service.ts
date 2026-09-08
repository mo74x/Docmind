import { Injectable, NotFoundException, MessageEvent } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Observable } from 'rxjs';
import { Document, DocumentStatus } from './document.entity';
import { Chunk } from './chunk.entity';
import { IngestDocumentDto } from './dto/ingest-document.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import {
  IngestionEventsService,
  IngestionProgressEvent,
} from '../ingestion/ingestion-events.service';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    @InjectRepository(Chunk)
    private readonly chunkRepo: Repository<Chunk>,
    @InjectQueue('ingestion')
    private readonly ingestionQueue: Queue,
    private readonly ingestionEventsService: IngestionEventsService,
  ) {}

  async submitDocument(
    dto: IngestDocumentDto,
    workspaceId?: string | null,
  ): Promise<Document> {
    // Save document to DB
    const document = this.documentRepo.create({
      title: dto.title,
      sourceContent: dto.content,
      workspaceId: workspaceId ?? dto.workspaceId ?? null,
    });
    const savedDocument = await this.documentRepo.save(document);

    // Dispatch background job to the 'ingestion' queue with retries and DLQ retention
    await this.ingestionQueue.add(
      'ingest-doc',
      {
        documentId: savedDocument.id,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnFail: false,
      },
    );

    return savedDocument;
  }

  async findAll(
    dto: PaginationDto = new PaginationDto(),
    workspaceId?: string | null,
  ): Promise<PaginatedResponseDto<Document>> {
    const page = dto.page || 1;
    const limit = dto.limit || 10;
    const order = dto.order || 'DESC';
    const skip = (page - 1) * limit;

    const whereCondition = workspaceId ? { workspaceId } : undefined;

    const [data, totalItems] = await this.documentRepo.findAndCount({
      where: whereCondition,
      skip,
      take: limit,
      order: { createdAt: order },
      select: {
        id: true,
        title: true,
        status: true,
        workspaceId: true,
        createdAt: true,
        failureReason: true,
      },
    });

    return new PaginatedResponseDto(data, totalItems, page, limit);
  }

  async findOne(id: string, workspaceId?: string | null): Promise<Document> {
    const document = await this.documentRepo.findOneBy({ id });
    if (!document) {
      throw new NotFoundException(`Document with ID ${id} not found`);
    }
    if (workspaceId && document.workspaceId !== workspaceId) {
      throw new NotFoundException(`Document with ID ${id} not found`);
    }
    return document;
  }

  async remove(
    id: string,
    workspaceId?: string | null,
  ): Promise<{ message: string; id: string }> {
    const document = await this.findOne(id, workspaceId);
    await this.chunkRepo.delete({ documentId: id });
    await this.documentRepo.delete(id);
    return {
      message: 'Document and associated chunks deleted successfully',
      id: document.id,
    };
  }

  /**
   * Returns an RxJS Observable streaming real-time Server-Sent Events (SSE)
   * for the document ingestion progress.
   */
  getProgressStream(id: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let isTerminal = false;

      // 1. Register listener for live events first to prevent race conditions
      const listener = (event: IngestionProgressEvent) => {
        subscriber.next({
          data: {
            documentId: event.documentId,
            status: event.status,
            percent: event.percent,
            step: event.step,
            message: event.message,
            ...(event.error ? { error: event.error } : {}),
          },
        });

        if (
          event.status === DocumentStatus.READY ||
          event.status === DocumentStatus.FAILED
        ) {
          isTerminal = true;
          subscriber.complete();
        }
      };

      this.ingestionEventsService.onProgress(id, listener);

      // 2. Fetch current document status from DB immediately
      this.findOne(id)
        .then((document) => {
          if (!isTerminal) {
            subscriber.next({
              data: {
                documentId: document.id,
                status: document.status,
                percent: this.getPercentForStatus(document.status),
                step: document.status,
                message: this.getMessageForStatus(document.status),
                ...(document.failureReason
                  ? { error: document.failureReason }
                  : {}),
              },
            });

            if (
              document.status === DocumentStatus.READY ||
              document.status === DocumentStatus.FAILED
            ) {
              isTerminal = true;
              subscriber.complete();
            }
          }
        })
        .catch((err) => {
          subscriber.error(err);
        });

      // 3. Teardown logic when client disconnects
      return () => {
        this.ingestionEventsService.offProgress(id, listener);
      };
    });
  }

  private getPercentForStatus(status: DocumentStatus): number {
    switch (status) {
      case DocumentStatus.PENDING:
        return 0;
      case DocumentStatus.CHUNKING:
        return 25;
      case DocumentStatus.EMBEDDING:
        return 50;
      case DocumentStatus.READY:
        return 100;
      case DocumentStatus.FAILED:
        return 0;
      default:
        return 0;
    }
  }

  private getMessageForStatus(status: DocumentStatus): string {
    switch (status) {
      case DocumentStatus.PENDING:
        return 'Document queued for ingestion';
      case DocumentStatus.CHUNKING:
        return 'Splitting document into chunks';
      case DocumentStatus.EMBEDDING:
        return 'Generating vector embeddings';
      case DocumentStatus.READY:
        return 'Document ingestion complete and ready for queries';
      case DocumentStatus.FAILED:
        return 'Document ingestion failed';
      default:
        return 'Processing document';
    }
  }
}
