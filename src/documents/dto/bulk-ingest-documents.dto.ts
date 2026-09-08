import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IngestDocumentDto } from './ingest-document.dto';

export class BulkIngestDocumentsDto {
  @ApiProperty({
    description: 'Array of documents to ingest in bulk (1 to 100 documents)',
    type: [IngestDocumentDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => IngestDocumentDto)
  documents: IngestDocumentDto[];

  @ApiPropertyOptional({
    description:
      'Optional default workspace identifier applied to items without an explicit workspaceId',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @IsOptional()
  @IsUUID()
  workspaceId?: string | null;
}
