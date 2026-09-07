import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateWorkspaceDto {
  @ApiProperty({
    description: 'Human-readable name of the workspace',
    example: 'Engineering Team',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    description: 'Unique URL-friendly slug. Auto-generated if omitted.',
    example: 'engineering-team',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  slug?: string;

  @ApiPropertyOptional({
    description:
      'Custom workspace secret API key. Auto-generated with prefix "dcm_ws_" if omitted.',
    example: 'dcm_ws_custom_secret_key_123',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  apiKey?: string;
}
