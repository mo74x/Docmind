/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockResponse: {
    status: jest.Mock;
    json: jest.Mock;
  };
  let mockRequest: {
    url: string;
    method: string;
    ip: string;
  };
  let mockArgumentsHost: ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockRequest = {
      url: '/api/test',
      method: 'POST',
      ip: '127.0.0.1',
    };

    const mockHttpArgumentsHost = {
      getResponse: jest.fn().mockReturnValue(mockResponse),
      getRequest: jest.fn().mockReturnValue(mockRequest),
    };

    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue(mockHttpArgumentsHost),
    } as unknown as ArgumentsHost;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('HttpException handling', () => {
    it('should format standard HttpException with string response correctly', () => {
      const exception = new NotFoundException('Document not found');

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          error: 'Not Found',
          message: 'Document not found',
          path: '/api/test',
          method: 'POST',
          timestamp: expect.any(String),
        }),
      );
    });

    it('should format HttpException with custom status code', () => {
      const exception = new HttpException(
        'Access Denied',
        HttpStatus.FORBIDDEN,
      );

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          error: 'HttpException',
          message: 'Access Denied',
          path: '/api/test',
          method: 'POST',
        }),
      );
    });

    it('should format validation errors with array messages correctly', () => {
      const validationErrorResponse = {
        statusCode: 400,
        error: 'Bad Request',
        message: [
          'title should not be empty',
          'content must be longer than or equal to 10 characters',
        ],
      };
      const exception = new BadRequestException(validationErrorResponse);

      filter.catch(exception, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          error: 'Bad Request',
          message: [
            'title should not be empty',
            'content must be longer than or equal to 10 characters',
          ],
          path: '/api/test',
          method: 'POST',
          timestamp: expect.any(String),
        }),
      );
    });

    it('should log warning for 4xx client errors without calling logger.error', () => {
      const loggerWarnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation();
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      const exception = new ForbiddenException('Forbidden area');

      filter.catch(exception, mockArgumentsHost);

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('HTTP 403 POST /api/test'),
      );
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('Unhandled Internal Errors', () => {
    it('should mask unhandled Error as 500 while logging full details and stack trace', () => {
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      const internalError = new Error('Database password connection timeout');

      filter.catch(internalError, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'An unexpected error occurred',
          path: '/api/test',
          method: 'POST',
          timestamp: expect.any(String),
        }),
      );

      // Verify internal details were logged
      expect(loggerErrorSpy).toHaveBeenNthCalledWith(
        1,
        'Unhandled Exception: Database password connection timeout',
        internalError.stack,
      );
      expect(loggerErrorSpy).toHaveBeenNthCalledWith(
        2,
        'HTTP 500 POST /api/test',
        expect.stringContaining('"statusCode":500'),
      );
    });

    it('should handle non-Error thrown objects gracefully and mask as 500', () => {
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      filter.catch('Raw primitive string rejection', mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'An unexpected error occurred',
          path: '/api/test',
          method: 'POST',
        }),
      );
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'HTTP 500 POST /api/test',
        expect.any(String),
      );
    });
  });
});
