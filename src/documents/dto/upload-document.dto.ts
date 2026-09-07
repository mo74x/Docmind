import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UploadDocumentDto {
  @ApiPropertyOptional({
    description:
      'Optional custom title for the document (defaults to sanitized file name without extension)',
    example: 'Architecture Whitepaper',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: 'Optional workspace identifier for tenant scoping',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'Document file to upload and ingest (.pdf, .docx, or .txt, max 10MB)',
  })
  file?: any;
}
