import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class BulkDeleteDocumentsDto {
  @ApiProperty({
    description: 'Array of document UUIDs to delete (1 to 100 IDs)',
    example: [
      'c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b',
      'e3b0c442-98fc-1c14-9afb-4c8996fb9242',
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids: string[];
}
