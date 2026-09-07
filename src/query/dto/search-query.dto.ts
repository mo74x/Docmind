import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsIn,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SearchQueryDto {
  @ApiProperty({
    description: 'The question to ask the knowledge base',
    example: 'What is the architecture of DocMind?',
  })
  @IsString()
  @IsNotEmpty()
  query: string;

  @ApiPropertyOptional({
    description: 'Number of matching chunks to return',
    default: 5,
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(20)
  limit?: number = 5;

  @ApiPropertyOptional({
    description:
      'Retrieval mode: dense vector similarity, full-text lexical search (BM25), or hybrid RRF fusion',
    enum: ['vector', 'fts', 'hybrid'],
    default: 'hybrid',
  })
  @IsOptional()
  @IsIn(['vector', 'fts', 'hybrid'])
  mode?: 'vector' | 'fts' | 'hybrid' = 'hybrid';

  @ApiPropertyOptional({
    description: 'Optional workspace identifier for tenant scoping',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @IsOptional()
  @IsString()
  workspaceId?: string;
}
