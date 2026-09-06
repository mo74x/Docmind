/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Inject } from '@nestjs/common';

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

export class TypeOrmModule {
  static forRoot(_options?: any) {
    return {
      module: TypeOrmModule,
      global: true,
      providers: [],
      exports: [],
    };
  }

  static forFeature(_entities?: any[]) {
    return {
      module: TypeOrmModule,
      providers: [],
      exports: [],
    };
  }
}
