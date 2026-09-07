import {
  IsString,
  IsNotEmpty,
  MinLength,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IngestDocumentDto {
  @ApiProperty({
    description: 'A recognizable title for the document',
    example: 'Hwala Core README',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: 'The raw text content to be chunked, embedded, and stored',
    example: 'DocMind is a Retrieval-Augmented Generation (RAG) backend...',
    minLength: 10,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  content: string;

  @ApiPropertyOptional({
    description: 'Optional workspace identifier for tenant scoping',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @IsOptional()
  @IsUUID()
  workspaceId?: string;
}
