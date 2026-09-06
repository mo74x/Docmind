/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { Document, DocumentStatus } from './document.entity';
import { Chunk } from './chunk.entity';
import { IngestDocumentDto } from './dto/ingest-document.dto';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let documentRepoMock: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOneBy: jest.Mock;
    delete: jest.Mock;
  };
  let chunkRepoMock: {
    delete: jest.Mock;
  };
  let ingestionQueueMock: {
    add: jest.Mock;
  };

  beforeEach(async () => {
    documentRepoMock = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOneBy: jest.fn(),
      delete: jest.fn(),
    };

    chunkRepoMock = {
      delete: jest.fn(),
    };

    ingestionQueueMock = {
      add: jest.fn(),
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
        failureReason: null as any,
        createdAt: new Date('2026-09-06T08:00:00Z'),
      };

      documentRepoMock.create.mockReturnValue(mockCreatedEntity);
      documentRepoMock.save.mockResolvedValue(mockSavedEntity);
      ingestionQueueMock.add.mockResolvedValue({ id: 'job-1' });

      const result = await service.submitDocument(dto);

      expect(documentRepoMock.create).toHaveBeenCalledWith({
        title: dto.title,
        sourceContent: dto.content,
      });
      expect(documentRepoMock.save).toHaveBeenCalledWith(mockCreatedEntity);
      expect(ingestionQueueMock.add).toHaveBeenCalledWith('ingest-doc', {
        documentId: mockSavedEntity.id,
      });
      expect(result).toEqual(mockSavedEntity);
    });
  });

  describe('findAll', () => {
    it('should return documents ordered by createdAt DESC with proper field selection', async () => {
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

      documentRepoMock.find.mockResolvedValue(mockDocuments);

      const results = await service.findAll();

      expect(documentRepoMock.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          failureReason: true,
        },
      });
      expect(results).toEqual(mockDocuments);
    });
  });

  describe('findOne', () => {
    it('should return document when document with ID exists', async () => {
      const mockDocument: Document = {
        id: 'doc-uuid-123',
        title: 'Single Document',
        sourceContent: 'Detailed content',
        status: DocumentStatus.READY,
        failureReason: null as any,
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
  });

  describe('remove', () => {
    it('should delete associated chunks first, then delete document record', async () => {
      const documentId = 'doc-uuid-123';
      const mockDocument: Document = {
        id: documentId,
        title: 'Doc to Delete',
        sourceContent: 'Some content',
        status: DocumentStatus.READY,
        failureReason: null as any,
        createdAt: new Date('2026-09-06T08:00:00Z'),
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
});
