import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
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
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(20)
  limit?: number = 5;
}
