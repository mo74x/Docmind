import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}
