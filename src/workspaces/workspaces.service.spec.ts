/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
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

  const rawTestKey = 'dcm_ws_test_key_123';
  const hashedKey = bcrypt.hashSync(rawTestKey, 10);

  const getMockWorkspace = (): Workspace => ({
    id: 'ws-uuid-1',
    name: 'Engineering',
    slug: 'engineering',
    apiKeyHash: hashedKey,
    apiKeyPrefix: 'dcm_ws_test_key',
    createdAt: new Date(),
  });

  beforeEach(async () => {
    workspaceRepoMock = {
      create: jest
        .fn()
        .mockImplementation((dto) => ({ ...dto, id: 'ws-uuid-1' })),
      save: jest.fn().mockImplementation((w) => Promise.resolve({ ...w })),
      find: jest
        .fn()
        .mockImplementation(() => Promise.resolve([getMockWorkspace()])),
      findOneBy: jest.fn(),
      remove: jest.fn().mockImplementation((w) => Promise.resolve(w)),
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
      workspaceRepoMock.find.mockResolvedValue([]);

      const result = await service.createWorkspace({ name: 'Finance Team' });

      expect(workspaceRepoMock.create).toHaveBeenCalledWith({
        name: 'Finance Team',
        slug: 'finance-team',
        apiKeyHash: expect.any(String),
        apiKeyPrefix: expect.stringMatching(/^dcm_ws_/),
      });
      expect(result.name).toBe('Finance Team');
      expect(result.apiKey).toMatch(/^dcm_ws_[a-f0-9]{48}$/);
      expect(result.apiKeyHash).toBeUndefined();
    });

    it('should throw ConflictException if slug already exists', async () => {
      workspaceRepoMock.findOneBy.mockResolvedValueOnce(getMockWorkspace());

      await expect(
        service.createWorkspace({ name: 'Engineering', slug: 'engineering' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if apiKey already exists', async () => {
      workspaceRepoMock.findOneBy.mockResolvedValueOnce(null); // slug check passes
      workspaceRepoMock.find.mockResolvedValueOnce([getMockWorkspace()]); // candidate with same prefix and hash

      await expect(
        service.createWorkspace({
          name: 'Engineering 2',
          apiKey: rawTestKey,
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
      expect(results[0].id).toBe('ws-uuid-1');
      expect(results[0].apiKeyHash).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('should return workspace if found', async () => {
      workspaceRepoMock.findOneBy.mockResolvedValue(getMockWorkspace());
      const result = await service.findById('ws-uuid-1');
      expect(result.id).toBe('ws-uuid-1');
      expect(result.apiKeyHash).toBeUndefined();
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
      workspaceRepoMock.find.mockResolvedValue([getMockWorkspace()]);
      const result = await service.findByApiKey(rawTestKey);
      expect(workspaceRepoMock.find).toHaveBeenCalledWith({
        where: { apiKeyPrefix: 'dcm_ws_test_key' },
      });
      expect(result).toBeDefined();
      expect(result?.id).toBe('ws-uuid-1');
      expect(result?.apiKeyHash).toBeUndefined();
    });

    it('should return null if no matching apiKey is found', async () => {
      workspaceRepoMock.find.mockResolvedValue([getMockWorkspace()]);
      const result = await service.findByApiKey('dcm_ws_wrong_key_xyz');
      expect(result).toBeNull();
    });

    it('should return null if apiKey is empty', async () => {
      const result = await service.findByApiKey('');
      expect(result).toBeNull();
    });
  });

  describe('deleteWorkspace', () => {
    it('should remove workspace if found', async () => {
      const ws = getMockWorkspace();
      workspaceRepoMock.findOneBy.mockResolvedValue(ws);
      await service.deleteWorkspace('ws-uuid-1');
      expect(workspaceRepoMock.remove).toHaveBeenCalledWith(ws);
    });
  });
});
