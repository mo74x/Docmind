/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { Workspace } from './workspace.entity';

describe('WorkspacesService', () => {
  let service: WorkspacesService;
  let workspaceRepoMock: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOneBy: jest.Mock;
    remove: jest.Mock;
  };

  const mockWorkspace: Workspace = {
    id: 'ws-uuid-1',
    name: 'Engineering',
    slug: 'engineering',
    apiKey: 'dcm_ws_test_key_123',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    workspaceRepoMock = {
      create: jest
        .fn()
        .mockImplementation((dto) => ({ ...dto, id: 'ws-uuid-1' })),
      save: jest.fn().mockImplementation((w) => Promise.resolve({ ...w })),
      find: jest.fn().mockResolvedValue([mockWorkspace]),
      findOneBy: jest.fn(),
      remove: jest.fn().mockResolvedValue(mockWorkspace),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspacesService,
        {
          provide: getRepositoryToken(Workspace),
          useValue: workspaceRepoMock,
        },
      ],
    }).compile();

    service = module.get<WorkspacesService>(WorkspacesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createWorkspace', () => {
    it('should create a workspace with auto-generated slug and apiKey if not provided', async () => {
      workspaceRepoMock.findOneBy.mockResolvedValue(null);

      const result = await service.createWorkspace({ name: 'Finance Team' });

      expect(workspaceRepoMock.create).toHaveBeenCalledWith({
        name: 'Finance Team',
        slug: 'finance-team',
        apiKey: expect.stringMatching(/^dcm_ws_[a-f0-9]{48}$/),
      });
      expect(result.name).toBe('Finance Team');
    });

    it('should throw ConflictException if slug already exists', async () => {
      workspaceRepoMock.findOneBy.mockResolvedValueOnce(mockWorkspace);

      await expect(
        service.createWorkspace({ name: 'Engineering', slug: 'engineering' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if apiKey already exists', async () => {
      workspaceRepoMock.findOneBy
        .mockResolvedValueOnce(null) // slug check passes
        .mockResolvedValueOnce(mockWorkspace); // apiKey check fails

      await expect(
        service.createWorkspace({
          name: 'Engineering 2',
          apiKey: 'dcm_ws_duplicate',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return all workspaces ordered by createdAt DESC', async () => {
      const results = await service.findAll();
      expect(workspaceRepoMock.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
      });
      expect(results).toEqual([mockWorkspace]);
    });
  });

  describe('findById', () => {
    it('should return workspace if found', async () => {
      workspaceRepoMock.findOneBy.mockResolvedValue(mockWorkspace);
      const result = await service.findById('ws-uuid-1');
      expect(result).toEqual(mockWorkspace);
    });

    it('should throw NotFoundException if workspace does not exist', async () => {
      workspaceRepoMock.findOneBy.mockResolvedValue(null);
      await expect(service.findById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByApiKey', () => {
    it('should return workspace matching apiKey', async () => {
      workspaceRepoMock.findOneBy.mockResolvedValue(mockWorkspace);
      const result = await service.findByApiKey('dcm_ws_test_key_123');
      expect(workspaceRepoMock.findOneBy).toHaveBeenCalledWith({
        apiKey: 'dcm_ws_test_key_123',
      });
      expect(result).toEqual(mockWorkspace);
    });
  });

  describe('deleteWorkspace', () => {
    it('should remove workspace if found', async () => {
      workspaceRepoMock.findOneBy.mockResolvedValue(mockWorkspace);
      await service.deleteWorkspace('ws-uuid-1');
      expect(workspaceRepoMock.remove).toHaveBeenCalledWith(mockWorkspace);
    });
  });
});
