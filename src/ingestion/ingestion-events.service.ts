import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { DocumentStatus } from '../documents/document.entity';

export interface IngestionProgressEvent {
  documentId: string;
  status: DocumentStatus;
  percent: number;
  step: 'PENDING' | 'CHUNKING' | 'EMBEDDING' | 'READY' | 'FAILED';
  message?: string;
  error?: string;
}

@Injectable()
export class IngestionEventsService {
  private readonly logger = new Logger(IngestionEventsService.name);
  private readonly emitter = new EventEmitter();

  constructor(
    @Optional()
    @Inject('REDIS_CLIENT')
    private readonly redisClient?: Redis,
  ) {
    this.emitter.setMaxListeners(100);
  }

  /**
   * Broadcasts an ingestion progress update to active in-memory listeners
   * and optionally publishes to Redis PubSub if configured.
   */
  emitProgress(event: IngestionProgressEvent): void {
    const channel = `document:${event.documentId}:progress`;
    this.emitter.emit(channel, event);

    if (
      this.redisClient &&
      typeof this.redisClient.publish === 'function' &&
      this.redisClient.status === 'ready'
    ) {
      this.redisClient
        .publish(`docmind:progress:${event.documentId}`, JSON.stringify(event))
        .catch((err: Error) => {
          this.logger.debug(
            `Failed to publish progress to Redis for ${event.documentId}: ${err.message}`,
          );
        });
    }
  }

  /**
   * Registers a listener for real-time progress events for a specific document.
   */
  onProgress(
    documentId: string,
    listener: (event: IngestionProgressEvent) => void,
  ): void {
    this.emitter.on(`document:${documentId}:progress`, listener);
  }

  /**
   * Removes a listener to prevent memory leaks when an SSE connection closes.
   */
  offProgress(
    documentId: string,
    listener: (event: IngestionProgressEvent) => void,
  ): void {
    this.emitter.off(`document:${documentId}:progress`, listener);
  }
}
