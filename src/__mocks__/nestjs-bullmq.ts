/* eslint-disable @typescript-eslint/no-unused-vars */
import { Inject } from '@nestjs/common';

export function getQueueToken(name?: string): string {
  return name ? `BullQueue_${name}` : 'BullQueue_default';
}

export function InjectQueue(name?: string) {
  return Inject(getQueueToken(name));
}

export class WorkerHost {
  process(_job: any): Promise<any> {
    return Promise.resolve();
  }
}

export function Processor(_queueNameOrOptions?: any): ClassDecorator {
  return (_target: any) => {};
}

export class BullModule {
  static forRoot(_options?: any) {
    return {
      module: BullModule,
      global: true,
      providers: [],
      exports: [],
    };
  }

  static registerQueue(..._queues: any[]) {
    return {
      module: BullModule,
      providers: [],
      exports: [],
    };
  }
}
