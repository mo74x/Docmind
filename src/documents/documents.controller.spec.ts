/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import 'multer';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentStatus } from './document.entity';

describe('DocumentsController', () => {
  let controller: DocumentsController;
  let service: jest.Mocked<Partial<DocumentsService>>;

  const mockDocument = {
    id: 'mock-doc-uuid',
    title: 'Test Document',
    sourceContent: 'Sample content',
    status: DocumentStatus.PENDING,
    failureReason: null,
    createdAt: new Date(),
    chunks: [],
  };

  beforeEach(async () => {
    service = {
      submitDocument: jest.fn().mockResolvedValue(mockDocument),
      findAll: jest.fn().mockResolvedValue({
        data: [mockDocument],
        meta: {
          page: 1,
          limit: 10,
          totalItems: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }),
      findOne: jest.fn().mockResolvedValue(mockDocument),
      remove: jest.fn().mockResolvedValue({
        message: 'Document and associated chunks deleted successfully',
        id: 'mock-doc-uuid',
      }),
      getProgressStream: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [
        {
          provide: DocumentsService,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get<DocumentsController>(DocumentsController);
  });

  describe('ingest', () => {
    it('should submit document via service and return 201 formatted response', async () => {
      const result = await controller.ingest(
        {
          title: 'New Doc',
          content: 'Content text',
        },
        null,
      );

      expect(service.submitDocument).toHaveBeenCalledWith(
        {
          title: 'New Doc',
          content: 'Content text',
        },
        null,
      );
      expect(result).toEqual({
        message: 'Document queued for ingestion',
        id: 'mock-doc-uuid',
        status: DocumentStatus.PENDING,
        workspaceId: undefined,
      });
    });
  });

  describe('uploadFile', () => {
    it('should throw BadRequestException if file is missing', async () => {
      await expect(
        controller.uploadFile(
          undefined as unknown as Express.Multer.File,
          {},
          null,
        ),
      ).rejects.toThrow(new BadRequestException('File is required'));
    });

    it('should extract text and submit document with custom title if provided', async () => {
      const mockFile = {
        originalname: 'whitepaper.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('DocMind whitepaper text content'),
        size: 32,
      } as Express.Multer.File;

      const result = await controller.uploadFile(
        mockFile,
        {
          title: 'Custom Title Override',
        },
        null,
      );

      expect(service.submitDocument).toHaveBeenCalledWith(
        {
          title: 'Custom Title Override',
          content: 'DocMind whitepaper text content',
          workspaceId: null,
        },
        null,
      );
      expect(result).toEqual({
        message: 'Document uploaded and queued for ingestion',
        id: 'mock-doc-uuid',
        status: DocumentStatus.PENDING,
        workspaceId: undefined,
      });
    });

    it('should extract text and default title to sanitized filename when omitted', async () => {
      const mockFile = {
        originalname: 'sample_notes.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('Extracted notes content'),
        size: 23,
      } as Express.Multer.File;

      const result = await controller.uploadFile(mockFile, {}, null);

      expect(service.submitDocument).toHaveBeenCalledWith(
        {
          title: 'sample_notes',
          content: 'Extracted notes content',
          workspaceId: null,
        },
        null,
      );
      expect(result).toEqual({
        message: 'Document uploaded and queued for ingestion',
        id: 'mock-doc-uuid',
        status: DocumentStatus.PENDING,
        workspaceId: undefined,
      });
    });
  });

  describe('findAll', () => {
    it('should delegate to documentsService.findAll', async () => {
      const result = await controller.findAll(
        {
          page: 1,
          limit: 10,
          order: 'DESC',
        },
        null,
      );
      expect(service.findAll).toHaveBeenCalledWith(
        {
          page: 1,
          limit: 10,
          order: 'DESC',
        },
        null,
      );
      expect(result.data).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('should retrieve a document by ID', async () => {
      const result = await controller.findOne('mock-doc-uuid', null);
      expect(service.findOne).toHaveBeenCalledWith('mock-doc-uuid', null);
      expect(result.id).toBe('mock-doc-uuid');
    });
  });

  describe('streamProgress', () => {
    it('should delegate to documentsService.getProgressStream', () => {
      const mockObservable = { subscribe: jest.fn() } as any;
      service.getProgressStream = jest.fn().mockReturnValue(mockObservable);

      const result = controller.streamProgress('mock-doc-uuid');

      expect(service.getProgressStream).toHaveBeenCalledWith('mock-doc-uuid');
      expect(result).toBe(mockObservable);
    });
  });

  describe('remove', () => {
    it('should delete a document and return confirmation', async () => {
      const result = await controller.remove('mock-doc-uuid', null);
      expect(service.remove).toHaveBeenCalledWith('mock-doc-uuid', null);
      expect(result.id).toBe('mock-doc-uuid');
    });
  });
});
