/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  IngestionEventsService,
  IngestionProgressEvent,
} from './ingestion-events.service';
import { DocumentStatus } from '../documents/document.entity';

describe('IngestionEventsService', () => {
  let service: IngestionEventsService;
  let mockRedisClient: any;

  beforeEach(() => {
    mockRedisClient = {
      status: 'ready',
      publish: jest.fn().mockResolvedValue(1),
    };
    service = new IngestionEventsService(mockRedisClient);
  });

  it('should notify registered listeners when progress is emitted for matching document', () => {
    const listener = jest.fn();
    service.onProgress('doc-1', listener);

    const event: IngestionProgressEvent = {
      documentId: 'doc-1',
      status: DocumentStatus.CHUNKING,
      step: 'CHUNKING',
      percent: 25,
      message: 'Splitting text into chunks',
    };

    service.emitProgress(event);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(event);
  });

  it('should not notify listeners registered for a different document ID', () => {
    const listenerDoc1 = jest.fn();
    const listenerDoc2 = jest.fn();

    service.onProgress('doc-1', listenerDoc1);
    service.onProgress('doc-2', listenerDoc2);

    const event: IngestionProgressEvent = {
      documentId: 'doc-1',
      status: DocumentStatus.EMBEDDING,
      step: 'EMBEDDING',
      percent: 50,
      message: 'Generating embeddings',
    };

    service.emitProgress(event);

    expect(listenerDoc1).toHaveBeenCalledWith(event);
    expect(listenerDoc2).not.toHaveBeenCalled();
  });

  it('should stop notifying listeners once unsubscribed via offProgress', () => {
    const listener = jest.fn();
    service.onProgress('doc-1', listener);

    service.emitProgress({
      documentId: 'doc-1',
      status: DocumentStatus.CHUNKING,
      step: 'CHUNKING',
      percent: 25,
    });
    expect(listener).toHaveBeenCalledTimes(1);

    service.offProgress('doc-1', listener);

    service.emitProgress({
      documentId: 'doc-1',
      status: DocumentStatus.READY,
      step: 'READY',
      percent: 100,
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should publish to Redis PubSub channel when Redis client is ready', () => {
    const event: IngestionProgressEvent = {
      documentId: 'doc-1',
      status: DocumentStatus.READY,
      step: 'READY',
      percent: 100,
      message: 'Ingestion complete',
    };

    service.emitProgress(event);

    expect(mockRedisClient.publish).toHaveBeenCalledWith(
      'docmind:progress:doc-1',
      JSON.stringify(event),
    );
  });

  it('should gracefully handle service initialized without Redis client', () => {
    const serviceWithoutRedis = new IngestionEventsService(undefined);
    const listener = jest.fn();
    serviceWithoutRedis.onProgress('doc-2', listener);

    const event: IngestionProgressEvent = {
      documentId: 'doc-2',
      status: DocumentStatus.READY,
      step: 'READY',
      percent: 100,
    };

    expect(() => serviceWithoutRedis.emitProgress(event)).not.toThrow();
    expect(listener).toHaveBeenCalledWith(event);
  });
});
