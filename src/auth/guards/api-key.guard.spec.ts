/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from './api-key.guard';
import { WorkspacesService } from '../../workspaces/workspaces.service';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let reflectorMock: {
    getAllAndOverride: jest.Mock;
  };
  let configServiceMock: {
    get: jest.Mock;
  };
  let workspacesServiceMock: {
    findByApiKey: jest.Mock;
  };

  const createMockExecutionContext = (
    headers: Record<string, string> = {},
    url = '/documents',
  ): { context: ExecutionContext; request: any } => {
    const request: any = {
      headers,
      url,
      originalUrl: url,
    };

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(request),
        getResponse: jest.fn(),
      }),
    } as unknown as ExecutionContext;

    return { context, request };
  };

  beforeEach(() => {
    reflectorMock = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    };
    configServiceMock = {
      get: jest.fn().mockReturnValue(undefined),
    };
    workspacesServiceMock = {
      findByApiKey: jest.fn().mockResolvedValue(null),
    };

    guard = new ApiKeyGuard(
      reflectorMock as unknown as Reflector,
      configServiceMock as unknown as ConfigService,
      workspacesServiceMock as unknown as WorkspacesService,
    );
  });

  afterEach(() => {
    delete process.env.API_KEY;
    jest.clearAllMocks();
  });

  describe('Public access bypass', () => {
    it('should allow request when @Public() decorator is present on route', async () => {
      reflectorMock.getAllAndOverride.mockReturnValue(true);
      const { context } = createMockExecutionContext();

      expect(await guard.canActivate(context)).toBe(true);
    });

    it('should allow access to /health without API key', async () => {
      configServiceMock.get.mockReturnValue('secret-key');
      const { context } = createMockExecutionContext({}, '/health');

      expect(await guard.canActivate(context)).toBe(true);
    });

    it('should allow access to /metrics without API key', async () => {
      configServiceMock.get.mockReturnValue('secret-key');
      const { context } = createMockExecutionContext({}, '/metrics');

      expect(await guard.canActivate(context)).toBe(true);
    });

    it('should allow access to /api/docs without API key', async () => {
      configServiceMock.get.mockReturnValue('secret-key');
      const { context } = createMockExecutionContext({}, '/api/docs');

      expect(await guard.canActivate(context)).toBe(true);
    });
  });

  describe('Development mode bypass', () => {
    it('should allow request when API_KEY is not configured and attach null workspaceId', async () => {
      configServiceMock.get.mockReturnValue(undefined);
      delete process.env.API_KEY;

      const { context, request } = createMockExecutionContext({}, '/documents');

      expect(await guard.canActivate(context)).toBe(true);
      expect(request.workspaceId).toBeNull();
    });

    it('should allow request and attach x-workspace-id header in development mode', async () => {
      configServiceMock.get.mockReturnValue(undefined);
      delete process.env.API_KEY;

      const { context, request } = createMockExecutionContext(
        { 'x-workspace-id': 'dev-ws-123' },
        '/documents',
      );

      expect(await guard.canActivate(context)).toBe(true);
      expect(request.workspaceId).toBe('dev-ws-123');
    });
  });

  describe('Super Admin Master Key verification', () => {
    const masterKey = 'master-admin-secret-key-12345';

    beforeEach(() => {
      configServiceMock.get.mockReturnValue(masterKey);
    });

    it('should allow request with master key and set isSuperAdmin to true', async () => {
      const { context, request } = createMockExecutionContext({
        'x-api-key': masterKey,
      });

      expect(await guard.canActivate(context)).toBe(true);
      expect(request.isSuperAdmin).toBe(true);
      expect(request.workspaceId).toBeNull();
    });

    it('should allow request with master key and scope to x-workspace-id if provided', async () => {
      const { context, request } = createMockExecutionContext({
        'x-api-key': masterKey,
        'x-workspace-id': 'target-ws-999',
      });

      expect(await guard.canActivate(context)).toBe(true);
      expect(request.isSuperAdmin).toBe(true);
      expect(request.workspaceId).toBe('target-ws-999');
    });
  });

  describe('Workspace Scoped API Key verification', () => {
    const masterKey = 'master-admin-secret-key-12345';
    const workspaceKey = 'dcm_ws_engineer_secret_key';
    const mockWorkspace = {
      id: 'ws-eng-1',
      name: 'Engineering',
      slug: 'engineering',
      apiKey: workspaceKey,
      createdAt: new Date(),
    };

    beforeEach(() => {
      configServiceMock.get.mockReturnValue(masterKey);
    });

    it('should allow request matching workspace apiKey and attach workspaceId', async () => {
      workspacesServiceMock.findByApiKey.mockResolvedValue(mockWorkspace);

      const { context, request } = createMockExecutionContext({
        'x-api-key': workspaceKey,
      });

      expect(await guard.canActivate(context)).toBe(true);
      expect(request.isSuperAdmin).toBe(false);
      expect(request.workspaceId).toBe('ws-eng-1');
      expect(request.workspace).toEqual(mockWorkspace);
    });

    it('should allow request via Authorization Bearer token matching workspace key', async () => {
      workspacesServiceMock.findByApiKey.mockResolvedValue(mockWorkspace);

      const { context, request } = createMockExecutionContext({
        authorization: `Bearer ${workspaceKey}`,
      });

      expect(await guard.canActivate(context)).toBe(true);
      expect(request.workspaceId).toBe('ws-eng-1');
    });

    it('should allow request when x-workspace-id matches workspace.id', async () => {
      workspacesServiceMock.findByApiKey.mockResolvedValue(mockWorkspace);

      const { context, request } = createMockExecutionContext({
        'x-api-key': workspaceKey,
        'x-workspace-id': 'ws-eng-1',
      });

      expect(await guard.canActivate(context)).toBe(true);
      expect(request.workspaceId).toBe('ws-eng-1');
    });

    it('should throw ForbiddenException if x-workspace-id does not match workspace.id', async () => {
      workspacesServiceMock.findByApiKey.mockResolvedValue(mockWorkspace);

      const { context } = createMockExecutionContext({
        'x-api-key': workspaceKey,
        'x-workspace-id': 'ws-foreign-other-team',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw UnauthorizedException when API key is invalid', async () => {
      workspacesServiceMock.findByApiKey.mockResolvedValue(null);

      const { context } = createMockExecutionContext({
        'x-api-key': 'invalid-key-value',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when no API key is provided and master key is configured', async () => {
      const { context } = createMockExecutionContext({});

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
