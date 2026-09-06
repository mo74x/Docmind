import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from './api-key.guard';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let reflectorMock: {
    getAllAndOverride: jest.Mock;
  };
  let configServiceMock: {
    get: jest.Mock;
  };

  const createMockExecutionContext = (
    headers: Record<string, string> = {},
    url = '/documents',
  ): ExecutionContext => {
    const request = {
      headers,
      url,
      originalUrl: url,
    };

    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(request),
        getResponse: jest.fn(),
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflectorMock = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    };
    configServiceMock = {
      get: jest.fn().mockReturnValue(undefined),
    };

    guard = new ApiKeyGuard(
      reflectorMock as unknown as Reflector,
      configServiceMock as unknown as ConfigService,
    );
  });

  afterEach(() => {
    delete process.env.API_KEY;
    jest.clearAllMocks();
  });

  describe('Public access bypass', () => {
    it('should allow request when @Public() decorator is present on route', () => {
      reflectorMock.getAllAndOverride.mockReturnValue(true);
      const context = createMockExecutionContext();

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow access to /health without API key', () => {
      configServiceMock.get.mockReturnValue('secret-key');
      const context = createMockExecutionContext({}, '/health');

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow access to /metrics without API key', () => {
      configServiceMock.get.mockReturnValue('secret-key');
      const context = createMockExecutionContext({}, '/metrics');

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow access to /api/docs without API key', () => {
      configServiceMock.get.mockReturnValue('secret-key');
      const context = createMockExecutionContext({}, '/api/docs');

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Development mode bypass', () => {
    it('should allow request when API_KEY is not configured in environment or config', () => {
      configServiceMock.get.mockReturnValue(undefined);
      delete process.env.API_KEY;

      const context = createMockExecutionContext({}, '/documents');

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('API Key verification', () => {
    const validKey = 'docmind-secret-api-key-12345';

    beforeEach(() => {
      configServiceMock.get.mockReturnValue(validKey);
    });

    it('should allow request when valid x-api-key header is provided', () => {
      const context = createMockExecutionContext({
        'x-api-key': validKey,
      });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow request when valid Authorization: Bearer <key> is provided', () => {
      const context = createMockExecutionContext({
        authorization: `Bearer ${validKey}`,
      });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should throw UnauthorizedException when no API key is provided', () => {
      const context = createMockExecutionContext({});

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow(
        'Invalid or missing API key',
      );
    });

    it('should throw UnauthorizedException when invalid x-api-key is provided', () => {
      const context = createMockExecutionContext({
        'x-api-key': 'invalid-key-value',
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow(
        'Invalid or missing API key',
      );
    });

    it('should throw UnauthorizedException when invalid Authorization Bearer key is provided', () => {
      const context = createMockExecutionContext({
        authorization: 'Bearer wrong-bearer-key',
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(context)).toThrow(
        'Invalid or missing API key',
      );
    });
  });
});
