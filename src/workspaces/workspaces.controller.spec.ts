import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { Workspace } from './workspace.entity';

describe('WorkspacesController', () => {
  let controller: WorkspacesController;
  let workspacesServiceMock: {
    createWorkspace: jest.Mock;
    findAll: jest.Mock;
    findById: jest.Mock;
    deleteWorkspace: jest.Mock;
  };

  const mockWorkspace: Workspace = {
    id: 'ws-uuid-1',
    name: 'Engineering Team',
    slug: 'engineering-team',
    apiKeyPrefix: 'dcm_ws_1234567',
    apiKey: 'dcm_ws_1234567890abcdef1234567890abcdef1234567890abcdef',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    workspacesServiceMock = {
      createWorkspace: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      deleteWorkspace: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspacesController],
      providers: [
        {
          provide: WorkspacesService,
          useValue: workspacesServiceMock,
        },
      ],
    }).compile();

    controller = module.get<WorkspacesController>(WorkspacesController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createWorkspace', () => {
    it('should delegate to workspacesService.createWorkspace and return created entity', async () => {
      const dto: CreateWorkspaceDto = { name: 'Engineering Team' };
      workspacesServiceMock.createWorkspace.mockResolvedValue(mockWorkspace);

      const result = await controller.createWorkspace(dto);

      expect(workspacesServiceMock.createWorkspace).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockWorkspace);
      expect(result.apiKey).toBeDefined();
    });

    it('should propagate ConflictException when slug or key conflict occurs', async () => {
      const dto: CreateWorkspaceDto = {
        name: 'Engineering Team',
        slug: 'engineering-team',
      };
      workspacesServiceMock.createWorkspace.mockRejectedValue(
        new ConflictException(
          'Workspace with slug "engineering-team" already exists',
        ),
      );

      await expect(controller.createWorkspace(dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findAll', () => {
    it('should return all workspaces from service', async () => {
      workspacesServiceMock.findAll.mockResolvedValue([mockWorkspace]);

      const results = await controller.findAll();

      expect(workspacesServiceMock.findAll).toHaveBeenCalledTimes(1);
      expect(results).toEqual([mockWorkspace]);
    });
  });

  describe('findById', () => {
    it('should return workspace by ID', async () => {
      workspacesServiceMock.findById.mockResolvedValue(mockWorkspace);

      const result = await controller.findById('ws-uuid-1');

      expect(workspacesServiceMock.findById).toHaveBeenCalledWith('ws-uuid-1');
      expect(result).toEqual(mockWorkspace);
    });

    it('should propagate NotFoundException when workspace does not exist', async () => {
      workspacesServiceMock.findById.mockRejectedValue(
        new NotFoundException('Workspace with ID non-existent not found'),
      );

      await expect(controller.findById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteWorkspace', () => {
    it('should delegate deletion to workspacesService', async () => {
      workspacesServiceMock.deleteWorkspace.mockResolvedValue(undefined);

      await controller.deleteWorkspace('ws-uuid-1');

      expect(workspacesServiceMock.deleteWorkspace).toHaveBeenCalledWith(
        'ws-uuid-1',
      );
    });

    it('should propagate NotFoundException when workspace to delete is not found', async () => {
      workspacesServiceMock.deleteWorkspace.mockRejectedValue(
        new NotFoundException('Workspace with ID non-existent not found'),
      );

      await expect(controller.deleteWorkspace('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
