/* eslint-disable @typescript-eslint/no-unused-vars */
import { DynamicModule } from '@nestjs/common';

const defaultTestConfig: Record<string, any> = {
  'openai.apiKey': 'sk-test-mock-key-for-testing',
  'openai.embeddingModel': 'text-embedding-3-small',
  'openai.chatModel': 'gpt-4o-mini',
  'redis.host': 'localhost',
  'redis.port': 6379,
  'database.url': 'postgres://localhost:5432/docmind',
};

export class ConfigService<K = Record<string, any>> {
  private config: Record<string, any>;

  constructor(internalConfig: Record<string, any> = {}) {
    this.config = internalConfig;
  }

  get<T = any>(key: string, defaultValue?: T): T {
    if (this.config[key] !== undefined) {
      return this.config[key] as T;
    }
    if (defaultTestConfig[key] !== undefined) {
      return defaultTestConfig[key] as T;
    }
    return defaultValue as T;
  }
}

export class ConfigModule {
  static forRoot(_options?: any): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [ConfigService],
      exports: [ConfigService],
    };
  }

  static forFeature(_options?: any): DynamicModule {
    return {
      module: ConfigModule,
      providers: [ConfigService],
      exports: [ConfigService],
    };
  }
}
