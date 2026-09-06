import { ApiProperty } from '@nestjs/swagger';

export class PaginationMetaDto {
  @ApiProperty({ example: 1, description: 'Current page number' })
  page: number;

  @ApiProperty({ example: 10, description: 'Number of items per page' })
  limit: number;

  @ApiProperty({ example: 42, description: 'Total number of items' })
  totalItems: number;

  @ApiProperty({ example: 5, description: 'Total number of pages' })
  totalPages: number;

  @ApiProperty({ example: true, description: 'Whether there is a next page' })
  hasNextPage: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether there is a previous page',
  })
  hasPreviousPage: boolean;

  constructor(totalItems: number, page: number, limit: number) {
    this.page = page;
    this.limit = limit;
    this.totalItems = totalItems;
    this.totalPages = Math.max(1, Math.ceil(totalItems / limit));
    this.hasNextPage = page < this.totalPages;
    this.hasPreviousPage = page > 1;
  }
}

export class PaginatedResponseDto<T> {
  @ApiProperty({
    isArray: true,
    description: 'Array of items for the current page',
  })
  data: T[];

  @ApiProperty({
    type: () => PaginationMetaDto,
    description: 'Pagination metadata',
  })
  meta: PaginationMetaDto;

  constructor(data: T[], totalItems: number, page: number, limit: number) {
    this.data = data;
    this.meta = new PaginationMetaDto(totalItems, page, limit);
  }
}
