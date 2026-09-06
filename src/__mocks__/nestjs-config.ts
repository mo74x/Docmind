/* eslint-disable @typescript-eslint/no-unused-vars */
import { DynamicModule } from '@nestjs/common';

export class ConfigService<K = Record<string, any>> {
  private config: Record<string, any>;

  constructor(internalConfig: Record<string, any> = {}) {
    this.config = internalConfig;
  }

  get<T = any>(key: string, defaultValue?: T): T {
    if (this.config[key] !== undefined) {
      return this.config[key] as T;
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
