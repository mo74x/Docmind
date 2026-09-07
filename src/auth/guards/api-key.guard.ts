import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { WorkspacesService } from '../../workspaces/workspaces.service';

export interface AuthenticatedRequest extends Request {
  workspaceId?: string | null;
  workspace?: any;
  isSuperAdmin?: boolean;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Check for @Public() decorator on handler or controller class
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // 2. Check public path bypasses (/health, /metrics, /api/docs)
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = request.originalUrl || request.url || '';
    if (
      path.startsWith('/health') ||
      path.startsWith('/metrics') ||
      path.startsWith('/api/docs')
    ) {
      return true;
    }

    // Extract headers
    const xApiKey = request.headers['x-api-key'];
    const authHeader = request.headers['authorization'];
    const xWorkspaceIdHeader = request.headers['x-workspace-id'];
    const explicitWorkspaceId =
      typeof xWorkspaceIdHeader === 'string' &&
      xWorkspaceIdHeader.trim().length > 0
        ? xWorkspaceIdHeader.trim()
        : null;

    let providedKey: string | undefined;
    if (typeof xApiKey === 'string' && xApiKey.trim().length > 0) {
      providedKey = xApiKey.trim();
    } else if (
      typeof authHeader === 'string' &&
      authHeader.startsWith('Bearer ')
    ) {
      providedKey = authHeader.slice(7).trim();
    }

    const masterApiKey =
      this.configService.get<string>('apiKey') || process.env.API_KEY;

    // Case A: Super Admin Master Key match
    if (masterApiKey && providedKey === masterApiKey) {
      request.isSuperAdmin = true;
      request.workspaceId = explicitWorkspaceId;
      return true;
    }

    // Case B: Workspace-scoped API key match
    if (providedKey && this.workspacesService) {
      const workspace = await this.workspacesService.findByApiKey(providedKey);
      if (workspace) {
        if (explicitWorkspaceId && explicitWorkspaceId !== workspace.id) {
          throw new ForbiddenException(
            `Workspace key does not have access to workspace "${explicitWorkspaceId}"`,
          );
        }
        request.workspaceId = workspace.id;
        request.workspace = workspace;
        request.isSuperAdmin = false;
        return true;
      }
    }

    // Case C: Development mode (no master API_KEY configured)
    if (!masterApiKey) {
      if (!providedKey) {
        request.workspaceId = explicitWorkspaceId;
        return true;
      }
      throw new UnauthorizedException('Invalid or missing API key');
    }

    // Case D: Master key configured but invalid or missing key provided
    throw new UnauthorizedException('Invalid or missing API key');
  }
}
