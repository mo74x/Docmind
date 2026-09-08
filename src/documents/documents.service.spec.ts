/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { Document, DocumentStatus } from './document.entity';
import { Chunk } from './chunk.entity';
import { IngestDocumentDto } from './dto/ingest-document.dto';
import { IngestionEventsService } from '../ingestion/ingestion-events.service';
import { PaginationDto } from '../common/dto/pagination.dto';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let documentRepoMock: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findAndCount: jest.Mock;
    findOneBy: jest.Mock;
    delete: jest.Mock;
  };
  let chunkRepoMock: {
    delete: jest.Mock;
  };
  let ingestionQueueMock: {
    add: jest.Mock;
    addBulk: jest.Mock;
  };
  let eventsServiceMock: {
    onProgress: jest.Mock;
    offProgress: jest.Mock;
    emitProgress: jest.Mock;
  };

  beforeEach(async () => {
    documentRepoMock = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      findOneBy: jest.fn(),
      delete: jest.fn(),
    };

    chunkRepoMock = {
      delete: jest.fn(),
    };

    ingestionQueueMock = {
      add: jest.fn(),
      addBulk: jest.fn().mockResolvedValue([]),
    };

    eventsServiceMock = {
      onProgress: jest.fn(),
      offProgress: jest.fn(),
      emitProgress: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        {
          provide: getRepositoryToken(Document),
          useValue: documentRepoMock,
        },
        {
          provide: getRepositoryToken(Chunk),
          useValue: chunkRepoMock,
        },
        {
          provide: getQueueToken('ingestion'),
          useValue: ingestionQueueMock,
        },
        {
          provide: IngestionEventsService,
          useValue: eventsServiceMock,
        },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('submitDocument', () => {
    it('should create entity with PENDING status, save to DB, and enqueue BullMQ job', async () => {
      const dto: IngestDocumentDto = {
        title: 'Architecture Blueprint',
        content: 'Comprehensive microservices and RAG pipeline documentation.',
      };

      const mockCreatedEntity = {
        title: dto.title,
        sourceContent: dto.content,
        status: DocumentStatus.PENDING,
      };

      const mockSavedEntity: Document = {
        id: 'doc-uuid-123',
        title: dto.title,
        sourceContent: dto.content,
        status: DocumentStatus.PENDING,
        failureReason: null,
        createdAt: new Date('2026-09-06T08:00:00Z'),
        workspaceId: null,
      };

      documentRepoMock.create.mockReturnValue(mockCreatedEntity);
      documentRepoMock.save.mockResolvedValue(mockSavedEntity);
      ingestionQueueMock.add.mockResolvedValue({ id: 'job-1' });

      const result = await service.submitDocument(dto);

      expect(documentRepoMock.create).toHaveBeenCalledWith({
        title: dto.title,
        sourceContent: dto.content,
        workspaceId: null,
      });
      expect(ingestionQueueMock.add).toHaveBeenCalledWith(
        'ingest-doc',
        {
          documentId: mockSavedEntity.id,
        },
        expect.objectContaining({
          attempts: 3,
          removeOnFail: false,
        }),
      );
      expect(result).toEqual(mockSavedEntity);
    });

    it('should assign workspaceId when provided in submitDocument', async () => {
      const dto: IngestDocumentDto = {
        title: 'Workspace Document',
        content: 'Content for specific workspace.',
        workspaceId: 'ws-team-1',
      };
      documentRepoMock.create.mockReturnValue({ ...dto });
      documentRepoMock.save.mockResolvedValue({ id: 'doc-ws-1', ...dto });
      ingestionQueueMock.add.mockResolvedValue({ id: 'job-ws' });

      await service.submitDocument(dto, 'ws-override-2');

      expect(documentRepoMock.create).toHaveBeenCalledWith({
        title: dto.title,
        sourceContent: dto.content,
        workspaceId: 'ws-override-2',
      });
    });
  });

  describe('submitDocumentsBulk', () => {
    it('should create entities, save them in batch, and enqueue jobs via addBulk', async () => {
      const dto = {
        documents: [
          { title: 'Doc 1', content: 'Content 1' },
          { title: 'Doc 2', content: 'Content 2' },
        ],
      };

      const mockSaved = [
        {
          id: 'doc-bulk-1',
          title: 'Doc 1',
          sourceContent: 'Content 1',
          status: DocumentStatus.PENDING,
          workspaceId: null,
        },
        {
          id: 'doc-bulk-2',
          title: 'Doc 2',
          sourceContent: 'Content 2',
          status: DocumentStatus.PENDING,
          workspaceId: null,
        },
      ];

      documentRepoMock.create.mockImplementation((item) => ({ ...item }));
      documentRepoMock.save.mockResolvedValue(mockSaved);

      const result = await service.submitDocumentsBulk(dto);

      expect(documentRepoMock.create).toHaveBeenCalledTimes(2);
      expect(documentRepoMock.save).toHaveBeenCalled();
      expect(ingestionQueueMock.addBulk).toHaveBeenCalledWith([
        {
          name: 'ingest-doc',
          data: { documentId: 'doc-bulk-1' },
          opts: expect.objectContaining({ attempts: 3, removeOnFail: false }),
        },
        {
          name: 'ingest-doc',
          data: { documentId: 'doc-bulk-2' },
          opts: expect.objectContaining({ attempts: 3, removeOnFail: false }),
        },
      ]);
      expect(result.count).toBe(2);
      expect(result.documents).toHaveLength(2);
    });

    it('should assign workspaceId to all documents in batch when provided', async () => {
      const dto = {
        documents: [{ title: 'Doc 1', content: 'Content 1' }],
      };

      documentRepoMock.create.mockImplementation((item) => ({ ...item }));
      documentRepoMock.save.mockResolvedValue([
        { id: 'doc-1', title: 'Doc 1', workspaceId: 'ws-bulk-tenant' },
      ]);

      await service.submitDocumentsBulk(dto, 'ws-bulk-tenant');

      expect(documentRepoMock.create).toHaveBeenCalledWith({
        title: 'Doc 1',
        sourceContent: 'Content 1',
        workspaceId: 'ws-bulk-tenant',
      });
    });
  });

  describe('findAll', () => {
    const mockDocuments = [
      {
        id: 'doc-1',
        title: 'Document One',
        status: DocumentStatus.READY,
        createdAt: new Date('2026-09-06T08:00:00Z'),
        failureReason: null,
      },
      {
        id: 'doc-2',
        title: 'Document Two',
        status: DocumentStatus.PENDING,
        createdAt: new Date('2026-09-06T07:00:00Z'),
        failureReason: null,
      },
    ];

    it('should return paginated documents with default parameters (page 1, limit 10, DESC)', async () => {
      documentRepoMock.findAndCount.mockResolvedValue([mockDocuments, 2]);

      const result = await service.findAll();

      expect(documentRepoMock.findAndCount).toHaveBeenCalledWith({
        where: undefined,
        skip: 0,
        take: 10,
        order: { createdAt: 'DESC' },
        select: {
          id: true,
          title: true,
          status: true,
          workspaceId: true,
          createdAt: true,
          failureReason: true,
        },
      });

      expect(result.data).toEqual(mockDocuments);
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        totalItems: 2,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });

    it('should apply custom pagination parameters and correctly calculate pagination metadata', async () => {
      documentRepoMock.findAndCount.mockResolvedValue([mockDocuments, 25]);

      const result = await service.findAll({
        page: 2,
        limit: 5,
        order: 'ASC',
      });

      expect(documentRepoMock.findAndCount).toHaveBeenCalledWith({
        where: undefined,
        skip: 5,
        take: 5,
        order: { createdAt: 'ASC' },
        select: {
          id: true,
          title: true,
          status: true,
          workspaceId: true,
          createdAt: true,
          failureReason: true,
        },
      });

      expect(result.data).toEqual(mockDocuments);
      expect(result.meta).toEqual({
        page: 2,
        limit: 5,
        totalItems: 25,
        totalPages: 5,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });

    it('should filter documents by workspaceId when provided', async () => {
      documentRepoMock.findAndCount.mockResolvedValue([mockDocuments, 2]);

      await service.findAll(new PaginationDto(), 'ws-team-1');

      expect(documentRepoMock.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'ws-team-1' },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return document when document with ID exists', async () => {
      const mockDocument: Document = {
        id: 'doc-uuid-123',
        title: 'Single Document',
        sourceContent: 'Detailed content',
        status: DocumentStatus.READY,
        workspaceId: null,
        failureReason: null,
        createdAt: new Date('2026-09-06T08:00:00Z'),
      };

      documentRepoMock.findOneBy.mockResolvedValue(mockDocument);

      const result = await service.findOne('doc-uuid-123');

      expect(documentRepoMock.findOneBy).toHaveBeenCalledWith({
        id: 'doc-uuid-123',
      });
      expect(result).toEqual(mockDocument);
    });

    it('should throw NotFoundException when document does not exist', async () => {
      documentRepoMock.findOneBy.mockResolvedValue(null);

      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        'Document with ID non-existent-id not found',
      );
      expect(documentRepoMock.findOneBy).toHaveBeenCalledWith({
        id: 'non-existent-id',
      });
    });

    it('should throw NotFoundException when document workspaceId does not match requested workspace', async () => {
      const mockDocument: Document = {
        id: 'doc-uuid-123',
        title: 'Single Document',
        sourceContent: 'Detailed content',
        status: DocumentStatus.READY,
        workspaceId: 'workspace-a',
        failureReason: null,
        createdAt: new Date('2026-09-06T08:00:00Z'),
      };
      documentRepoMock.findOneBy.mockResolvedValue(mockDocument);

      await expect(
        service.findOne('doc-uuid-123', 'workspace-b'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete associated chunks first, then delete document record', async () => {
      const documentId = 'doc-uuid-123';
      const mockDocument: Document = {
        id: documentId,
        title: 'Doc to Delete',
        sourceContent: 'Some content',
        status: DocumentStatus.READY,
        failureReason: null,
        createdAt: new Date('2026-09-06T08:00:00Z'),
        workspaceId: null,
      };

      documentRepoMock.findOneBy.mockResolvedValue(mockDocument);
      chunkRepoMock.delete.mockResolvedValue({ affected: 5 });
      documentRepoMock.delete.mockResolvedValue({ affected: 1 });

      const callOrder: string[] = [];
      chunkRepoMock.delete.mockImplementation(() => {
        callOrder.push('deleteChunks');
        return Promise.resolve({ affected: 5 });
      });
      documentRepoMock.delete.mockImplementation(() => {
        callOrder.push('deleteDocument');
        return Promise.resolve({ affected: 1 });
      });

      const result = await service.remove(documentId);

      // Verify findOne is called first
      expect(documentRepoMock.findOneBy).toHaveBeenCalledWith({
        id: documentId,
      });

      // Verify chunkRepo.delete is called with documentId
      expect(chunkRepoMock.delete).toHaveBeenCalledWith({ documentId });

      // Verify documentRepo.delete is called with documentId
      expect(documentRepoMock.delete).toHaveBeenCalledWith(documentId);

      // Verify deletion order: chunks deleted BEFORE document
      expect(callOrder).toEqual(['deleteChunks', 'deleteDocument']);

      expect(result).toEqual({
        message: 'Document and associated chunks deleted successfully',
        id: documentId,
      });
    });

    it('should throw NotFoundException and NOT delete chunks or document if document does not exist', async () => {
      const documentId = 'non-existent-id';
      documentRepoMock.findOneBy.mockResolvedValue(null);

      await expect(service.remove(documentId)).rejects.toThrow(
        NotFoundException,
      );

      expect(documentRepoMock.findOneBy).toHaveBeenCalledWith({
        id: documentId,
      });
      expect(chunkRepoMock.delete).not.toHaveBeenCalled();
      expect(documentRepoMock.delete).not.toHaveBeenCalled();
    });
  });

  describe('removeBulk', () => {
    it('should delete matching documents and chunks in bulk, reporting deleted and notFound IDs', async () => {
      const ids = ['doc-1', 'doc-2', 'doc-notfound'];
      const mockFound = [{ id: 'doc-1' }, { id: 'doc-2' }];

      documentRepoMock.find.mockResolvedValue(mockFound);
      chunkRepoMock.delete.mockResolvedValue({ affected: 4 });
      documentRepoMock.delete.mockResolvedValue({ affected: 2 });

      const result = await service.removeBulk(ids);

      expect(documentRepoMock.find).toHaveBeenCalledWith({
        where: expect.anything(),
        select: { id: true },
      });
      expect(chunkRepoMock.delete).toHaveBeenCalledWith({
        documentId: expect.anything(),
      });
      expect(documentRepoMock.delete).toHaveBeenCalledWith({
        id: expect.anything(),
      });
      expect(result.deletedCount).toBe(2);
      expect(result.deletedIds).toEqual(['doc-1', 'doc-2']);
      expect(result.notFoundIds).toEqual(['doc-notfound']);
    });

    it('should scope deletion to workspaceId when provided', async () => {
      const ids = ['doc-1'];
      documentRepoMock.find.mockResolvedValue([]);

      const result = await service.removeBulk(ids, 'ws-tenant-alpha');

      expect(documentRepoMock.find).toHaveBeenCalledWith({
        where: expect.objectContaining({ workspaceId: 'ws-tenant-alpha' }),
        select: { id: true },
      });
      expect(result.deletedCount).toBe(0);
      expect(result.notFoundIds).toEqual(['doc-1']);
    });

    it('should return immediately when given an empty IDs list', async () => {
      const result = await service.removeBulk([]);
      expect(result.deletedCount).toBe(0);
      expect(documentRepoMock.find).not.toHaveBeenCalled();
    });
  });

  describe('getProgressStream', () => {
    const mockPendingDoc: Document = {
      id: 'doc-stream-1',
      title: 'Stream Doc',
      sourceContent: 'Content to stream',
      status: DocumentStatus.PENDING,
      failureReason: null,
      createdAt: new Date(),
      workspaceId: null,
    };

    it('should immediately emit current document status and relay live progress updates', (done) => {
      documentRepoMock.findOneBy.mockResolvedValue({ ...mockPendingDoc });

      let capturedListener: ((event: any) => void) | undefined;
      eventsServiceMock.onProgress.mockImplementation(
        (id: string, listener: any) => {
          capturedListener = listener;
        },
      );

      const events: any[] = [];
      const stream$ = service.getProgressStream('doc-stream-1');

      stream$.subscribe({
        next: (event) => {
          events.push(event);

          // Once initial PENDING status is received, trigger live CHUNKING & READY events
          if (events.length === 1 && capturedListener) {
            capturedListener({
              documentId: 'doc-stream-1',
              status: DocumentStatus.CHUNKING,
              step: 'CHUNKING',
              percent: 25,
              message: 'Splitting document into chunks',
            });

            capturedListener({
              documentId: 'doc-stream-1',
              status: DocumentStatus.READY,
              step: 'READY',
              percent: 100,
              message: 'Document ingestion complete and ready for queries',
            });
          }
        },
        complete: () => {
          expect(events).toHaveLength(3);

          // 1. Initial event from DB
          expect(events[0].data).toEqual(
            expect.objectContaining({
              documentId: 'doc-stream-1',
              status: DocumentStatus.PENDING,
              percent: 0,
              step: 'PENDING',
            }),
          );

          // 2. Live CHUNKING event
          expect(events[1].data).toEqual(
            expect.objectContaining({
              documentId: 'doc-stream-1',
              status: DocumentStatus.CHUNKING,
              percent: 25,
              step: 'CHUNKING',
            }),
          );

          // 3. Live READY event
          expect(events[2].data).toEqual(
            expect.objectContaining({
              documentId: 'doc-stream-1',
              status: DocumentStatus.READY,
              percent: 100,
              step: 'READY',
            }),
          );

          done();
        },
      });
    });

    it('should complete immediately if document is already in READY terminal state', (done) => {
      documentRepoMock.findOneBy.mockResolvedValue({
        ...mockPendingDoc,
        status: DocumentStatus.READY,
      });

      const events: any[] = [];
      const stream$ = service.getProgressStream('doc-stream-1');

      stream$.subscribe({
        next: (event) => events.push(event),
        complete: () => {
          expect(events).toHaveLength(1);
          expect(events[0].data).toEqual(
            expect.objectContaining({
              status: DocumentStatus.READY,
              percent: 100,
              step: 'READY',
            }),
          );
          done();
        },
      });
    });

    it('should complete immediately if document is already in FAILED terminal state', (done) => {
      documentRepoMock.findOneBy.mockResolvedValue({
        ...mockPendingDoc,
        status: DocumentStatus.FAILED,
        failureReason: 'Corrupted format',
      });

      const events: any[] = [];
      const stream$ = service.getProgressStream('doc-stream-1');

      stream$.subscribe({
        next: (event) => events.push(event),
        complete: () => {
          expect(events).toHaveLength(1);
          expect(events[0].data).toEqual(
            expect.objectContaining({
              status: DocumentStatus.FAILED,
              percent: 0,
              step: 'FAILED',
              error: 'Corrupted format',
            }),
          );
          done();
        },
      });
    });

    it('should clean up listener via offProgress when subscriber unsubscribes', () => {
      documentRepoMock.findOneBy.mockResolvedValue({ ...mockPendingDoc });

      const stream$ = service.getProgressStream('doc-stream-1');
      const subscription = stream$.subscribe();

      expect(eventsServiceMock.onProgress).toHaveBeenCalledWith(
        'doc-stream-1',
        expect.any(Function),
      );

      subscription.unsubscribe();

      expect(eventsServiceMock.offProgress).toHaveBeenCalledWith(
        'doc-stream-1',
        expect.any(Function),
      );
    });

    it('should emit error on subscriber if document is not found', (done) => {
      documentRepoMock.findOneBy.mockResolvedValue(null);

      const stream$ = service.getProgressStream('non-existent');

      stream$.subscribe({
        next: () => done.fail('Should not emit next on not found'),
        error: (err) => {
          expect(err).toBeInstanceOf(NotFoundException);
          done();
        },
      });
    });
  });
});
