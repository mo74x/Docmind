import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UploadDocumentDto {
  @ApiPropertyOptional({
    description:
      'Optional custom title for the document (defaults to sanitized file name without extension)',
    example: 'Architecture Whitepaper',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'Document file to upload and ingest (.pdf, .docx, or .txt, max 10MB)',
  })
  file?: any;
}
