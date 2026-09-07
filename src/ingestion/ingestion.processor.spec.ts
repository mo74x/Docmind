/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { IngestionProcessor } from './ingestion.processor';
import { DocumentStatus, Document } from '../documents/document.entity';

describe('IngestionProcessor', () => {
  let processor: IngestionProcessor;
  let mockDocumentRepo: any;
  let mockEmbeddingsService: any;
  let mockConfigService: any;
  let mockDataSource: any;
  let mockEventsService: any;

  const mockDocument: Document = {
    id: 'doc-uuid-1',
    title: 'Test Document',
    sourceContent: 'Sample source content that will be chunked and embedded.',
    status: DocumentStatus.PENDING,
    failureReason: null,
    createdAt: new Date(),
    workspaceId: null,
  };

  beforeEach(() => {
    mockDocumentRepo = {
      findOneBy: jest.fn().mockResolvedValue({ ...mockDocument }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    mockEmbeddingsService = {
      embedBatch: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'chunking.size') return 1200;
        if (key === 'chunking.overlap') return 200;
        return undefined;
      }),
    };

    mockDataSource = {
      query: jest.fn().mockResolvedValue([]),
    };

    mockEventsService = {
      emitProgress: jest.fn(),
    };

    processor = new IngestionProcessor(
      mockDocumentRepo,
      mockEmbeddingsService,
      mockConfigService,
      mockDataSource,
      mockEventsService,
    );
  });

  it('should process document, update job progress and emit real-time events through all phases', async () => {
    const job: any = {
      data: { documentId: 'doc-uuid-1' },
      updateProgress: jest.fn().mockResolvedValue(undefined),
      opts: { attempts: 3 },
      attemptsMade: 0,
    };

    await processor.process(job);

    // 1. Verify DB status updates
    expect(mockDocumentRepo.update).toHaveBeenCalledWith('doc-uuid-1', {
      status: DocumentStatus.CHUNKING,
    });
    expect(mockDocumentRepo.update).toHaveBeenCalledWith('doc-uuid-1', {
      status: DocumentStatus.EMBEDDING,
    });
    expect(mockDocumentRepo.update).toHaveBeenCalledWith('doc-uuid-1', {
      status: DocumentStatus.READY,
    });

    // 2. Verify BullMQ job.updateProgress calls
    expect(job.updateProgress).toHaveBeenCalledWith({
      step: 'CHUNKING',
      percent: 25,
    });
    expect(job.updateProgress).toHaveBeenCalledWith({
      step: 'EMBEDDING',
      percent: 50,
    });
    expect(job.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        step: 'EMBEDDING',
        percent: expect.any(Number),
      }),
    );
    expect(job.updateProgress).toHaveBeenCalledWith({
      step: 'READY',
      percent: 100,
    });

    // 3. Verify IngestionEventsService emitProgress calls
    expect(mockEventsService.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-uuid-1',
        status: DocumentStatus.CHUNKING,
        step: 'CHUNKING',
        percent: 25,
      }),
    );
    expect(mockEventsService.emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-uuid-1',
        status: DocumentStatus.READY,
        step: 'READY',
        percent: 100,
      }),
    );
  });

  it('should handle document not found gracefully without errors', async () => {
    mockDocumentRepo.findOneBy.mockResolvedValue(null);

    const job: any = {
      data: { documentId: 'non-existent' },
      updateProgress: jest.fn(),
    };

    await processor.process(job);

    expect(job.updateProgress).not.toHaveBeenCalled();
    expect(mockEventsService.emitProgress).not.toHaveBeenCalled();
  });

  it('should report failure progress and emit FAILED event on terminal error', async () => {
    mockEmbeddingsService.embedBatch.mockRejectedValue(
      new Error('OpenAI API failure'),
    );

    const job: any = {
      data: { documentId: 'doc-uuid-1' },
      updateProgress: jest.fn().mockResolvedValue(undefined),
      opts: { attempts: 1 },
      attemptsMade: 0,
    };

    await expect(processor.process(job)).rejects.toThrow('OpenAI API failure');

    expect(mockDocumentRepo.update).toHaveBeenCalledWith('doc-uuid-1', {
      status: DocumentStatus.FAILED,
      failureReason: 'OpenAI API failure',
    });

    expect(job.updateProgress).toHaveBeenCalledWith({
      step: 'FAILED',
      percent: 0,
      error: 'OpenAI API failure',
    });

    expect(mockEventsService.emitProgress).toHaveBeenCalledWith({
      documentId: 'doc-uuid-1',
      status: DocumentStatus.FAILED,
      step: 'FAILED',
      percent: 0,
      message: 'Document ingestion failed',
      error: 'OpenAI API failure',
    });
  });

  it('should propagate workspaceId from document to chunks during storage', async () => {
    mockDocumentRepo.findOneBy.mockResolvedValue({
      ...mockDocument,
      workspaceId: 'ws-tenant-alpha',
    });

    const job: any = {
      data: { documentId: 'doc-uuid-1' },
      updateProgress: jest.fn().mockResolvedValue(undefined),
      opts: { attempts: 3 },
      attemptsMade: 0,
    };

    await processor.process(job);

    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('"workspaceId"'),
      expect.arrayContaining(['ws-tenant-alpha']),
    );
  });
});
