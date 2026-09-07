import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SendMessageDto {
  @ApiProperty({
    description: 'The user message or follow-up question',
    example: 'What is the default overlap size for the chunker?',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  @ApiPropertyOptional({
    description: 'Retrieval mode for knowledge base search',
    enum: ['vector', 'fts', 'hybrid'],
    default: 'hybrid',
  })
  @IsOptional()
  @IsIn(['vector', 'fts', 'hybrid'])
  mode?: 'vector' | 'fts' | 'hybrid' = 'hybrid';

  @ApiPropertyOptional({
    description: 'Number of context chunks to retrieve for RAG answering',
    default: 5,
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 5;
}
