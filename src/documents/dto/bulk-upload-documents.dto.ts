import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class BulkUploadDocumentsDto {
  @ApiPropertyOptional({
    description: 'Optional workspace identifier for tenant scoping',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'string',
      format: 'binary',
    },
    description:
      'Multiple document files to upload and ingest (.pdf, .docx, .txt, up to 10 files, 10MB each)',
  })
  files?: any[];
}
