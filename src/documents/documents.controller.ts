/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Controller, Post, Body, Get, Param, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { IngestDocumentDto } from './dto/ingest-document.dto';

@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a new document for RAG ingestion' })
  @ApiResponse({ status: 201, description: 'Document queued successfully' })
  async ingest(@Body() dto: IngestDocumentDto) {
    const document = await this.documentsService.submitDocument(dto);
    return {
      message: 'Document queued for ingestion',
      id: document.id,
      status: document.status,
    };
  }

  @Get()
  @ApiOperation({ summary: 'List all documents and their current statuses' })
  async findAll() {
    return this.documentsService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Poll a specific document by ID to check ingestion status',
  })
  async findOne(@Param('id') id: string) {
    const document = await this.documentsService.findOne(id);
    return {
      id: document.id,
      title: document.title,
      status: document.status,
      failureReason: document.failureReason,
      createdAt: document.createdAt,
    };
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a document and all its associated vector chunks',
  })
  @ApiResponse({
    status: 200,
    description: 'Document and associated chunks deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Document with the specified ID was not found',
  })
  remove(@Param('id') id: string) {
    return this.documentsService.remove(id);
  }
}
