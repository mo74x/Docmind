import { ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createMockContext = (options: {
    method?: string;
    url?: string;
    statusCode?: number;
  }) => {
    const request = {
      method: options.method || 'GET',
      originalUrl: options.url || '/api/test',
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('Jest-Client/1.0'),
    };
    const response = {
      statusCode: options.statusCode || 200,
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    return { context, request, response };
  };

  it('should log successful HTTP requests with duration and status code', (done) => {
    const { context } = createMockContext({
      method: 'POST',
      url: '/documents',
      statusCode: 201,
    });
    const callHandler: CallHandler = {
      handle: () => of({ success: true }),
    };

    interceptor.intercept(context, callHandler).subscribe({
      next: (val) => {
        expect(val).toEqual({ success: true });
      },
      complete: () => {
        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(logSpy).toHaveBeenCalledWith(
          expect.stringMatching(
            /POST \/documents 201 \+\d+ms - 127\.0\.0\.1 Jest-Client\/1\.0/,
          ),
        );
        done();
      },
    });
  });

  it('should log failed HTTP requests with error and rethrow', (done) => {
    const { context } = createMockContext({
      method: 'GET',
      url: '/documents/unknown',
      statusCode: 404,
    });
    const testError = { status: 404, message: 'Document not found' };
    const callHandler: CallHandler = {
      handle: () => throwError(() => testError),
    };

    interceptor.intercept(context, callHandler).subscribe({
      error: (err) => {
        expect(err).toEqual(testError);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringMatching(
            /GET \/documents\/unknown 404 \+\d+ms - 127\.0\.0\.1 Jest-Client\/1\.0 - Document not found/,
          ),
        );
        done();
      },
    });
  });
});
