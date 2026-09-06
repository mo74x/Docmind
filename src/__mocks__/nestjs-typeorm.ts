/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';

export function getRepositoryToken(
  entity: any,
  dataSource = 'default',
): string {
  if (!entity) {
    throw new Error('Invalid entity passed to getRepositoryToken');
  }
  const prefix = dataSource === 'default' ? '' : `${dataSource}_`;
  const name = typeof entity === 'string' ? entity : entity.name;
  return `${prefix}${name}Repository`;
}

export function InjectRepository(entity: any, dataSource = 'default') {
  return Inject(getRepositoryToken(entity, dataSource));
}

const mockDataSource = {
  query: () => Promise.resolve([]),
  getRepository: () => ({
    find: () => Promise.resolve([]),
    findAndCount: () => Promise.resolve([[], 0]),
    findOneBy: () => Promise.resolve(null),
    save: (e: any) => Promise.resolve({ id: 'mock-uuid', ...e }),
    create: (e: any) => e,
    delete: () => Promise.resolve({ affected: 1 }),
  }),
};

export class TypeOrmModule {
  static forRoot(_options?: any) {
    return {
      module: TypeOrmModule,
      global: true,
      providers: [
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
      exports: [DataSource],
    };
  }

  static forRootAsync(_options?: any) {
    return {
      module: TypeOrmModule,
      global: true,
      providers: [
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
      exports: [DataSource],
    };
  }

  static forFeature(entities: any[] = []) {
    const providers = entities.map((entity) => ({
      provide: getRepositoryToken(entity),
      useValue: {
        find: () => Promise.resolve([]),
        findAndCount: () => Promise.resolve([[], 0]),
        findOneBy: () => Promise.resolve(null),
        save: (e: any) => Promise.resolve({ id: 'mock-uuid', ...e }),
        create: (e: any) => e,
        delete: () => Promise.resolve({ affected: 1 }),
      },
    }));
    return {
      module: TypeOrmModule,
      providers,
      exports: providers.map((p) => p.provide),
    };
  }
}
