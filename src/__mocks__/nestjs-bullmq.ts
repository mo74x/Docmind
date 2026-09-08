/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
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

export function OnWorkerEvent(_event: string): MethodDecorator {
  return (
    _target: any,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) => descriptor;
}

const mockQueue = {
  add: () => Promise.resolve({ id: 'mock-job-id' }),
  process: () => Promise.resolve(),
};

export class BullModule {
  static forRoot(_options?: any) {
    return {
      module: BullModule,
      global: true,
      providers: [],
      exports: [],
    };
  }

  static forRootAsync(_options?: any) {
    return {
      module: BullModule,
      global: true,
      providers: [],
      exports: [],
    };
  }

  static registerQueue(...queues: any[]) {
    const providers = queues.map((q) => {
      const name = typeof q === 'string' ? q : q.name;
      return {
        provide: getQueueToken(name),
        useValue: mockQueue,
      };
    });
    return {
      module: BullModule,
      providers,
      exports: providers.map((p) => p.provide),
    };
  }
}
