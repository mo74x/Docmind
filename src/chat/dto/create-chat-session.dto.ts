import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateChatSessionDto {
  @ApiPropertyOptional({
    description: 'Initial display title for the chat session',
    example: 'DocMind Architecture Discussion',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({
    description: 'Optional workspace identifier for tenant scoping',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @IsOptional()
  @IsUUID()
  workspaceId?: string;
}
