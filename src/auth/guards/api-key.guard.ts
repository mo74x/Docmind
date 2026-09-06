import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Check for @Public() decorator on handler or controller class
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Check public path bypasses (/health, /metrics, /api/docs)
    const request = context.switchToHttp().getRequest<Request>();
    const path = request.originalUrl || request.url || '';
    if (
      path.startsWith('/health') ||
      path.startsWith('/metrics') ||
      path.startsWith('/api/docs')
    ) {
      return true;
    }

    // Check configured API key (allow all if not set in development)
    const validApiKey =
      this.configService.get<string>('apiKey') || process.env.API_KEY;

    if (!validApiKey) {
      return true;
    }

    // Extract API key from headers (x-api-key or Authorization: Bearer <key>)
    const xApiKey = request.headers['x-api-key'];
    const authHeader = request.headers['authorization'];

    let providedKey: string | undefined;

    if (typeof xApiKey === 'string' && xApiKey.trim().length > 0) {
      providedKey = xApiKey.trim();
    } else if (
      typeof authHeader === 'string' &&
      authHeader.startsWith('Bearer ')
    ) {
      providedKey = authHeader.slice(7).trim();
    }

    if (!providedKey || providedKey !== validApiKey) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    return true;
  }
}
