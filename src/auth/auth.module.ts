import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ApiKeyGuard } from './guards/api-key.guard';
import { WorkspacesModule } from '../workspaces/workspaces.module';

@Module({
  imports: [ConfigModule, WorkspacesModule],
  providers: [
    ApiKeyGuard,
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
  exports: [ApiKeyGuard],
})
export class AuthModule {}
