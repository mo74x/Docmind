/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import type { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const method = request.method;
    const originalUrl = request.originalUrl || request.url;
    const ip = request.ip || request.socket?.remoteAddress || '';
    const userAgent = request.get ? request.get('user-agent') || '' : '';
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const statusCode = response.statusCode;
        const duration = Date.now() - startTime;
        this.logger.log(
          `${method} ${originalUrl} ${statusCode} +${duration}ms - ${ip} ${userAgent}`.trim(),
        );
      }),
      catchError((error: any) => {
        const duration = Date.now() - startTime;
        const statusCode = error?.status || error?.statusCode || 500;
        this.logger.error(
          `${method} ${originalUrl} ${statusCode} +${duration}ms - ${ip} ${userAgent} - ${error?.message || error}`.trim(),
        );
        return throwError(() => error);
      }),
    );
  }
}
