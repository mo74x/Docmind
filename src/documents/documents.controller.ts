import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Delete,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import { DocumentsService } from './documents.service';
import { IngestDocumentDto } from './dto/ingest-document.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import {
  extractTextFromFile,
  sanitizeTitleFromFilename,
} from './utils/file-extractor.util';
import { CurrentWorkspaceId } from '../auth/decorators/current-workspace.decorator';

@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a new document for RAG ingestion' })
  @ApiResponse({ status: 201, description: 'Document queued successfully' })
  async ingest(
    @Body() dto: IngestDocumentDto,
    @CurrentWorkspaceId() workspaceId: string | null,
  ) {
    const effectiveWorkspaceId = workspaceId || dto.workspaceId || null;
    const document = await this.documentsService.submitDocument(
      dto,
      effectiveWorkspaceId,
    );
    return {
      message: 'Document queued for ingestion',
      id: document.id,
      status: document.status,
      workspaceId: document.workspaceId,
    };
  }

  @Post('upload')
  @ApiOperation({
    summary: 'Upload a document file (PDF, DOCX, TXT) for RAG ingestion',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Document file and optional title',
    type: UploadDocumentDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Document uploaded and queued for ingestion',
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid file, unsupported format, file exceeds 10MB, or contains no readable text',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @CurrentWorkspaceId() workspaceId: string | null,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const content = await extractTextFromFile(file);
    const title =
      dto?.title?.trim() || sanitizeTitleFromFilename(file.originalname);
    const effectiveWorkspaceId = workspaceId || dto?.workspaceId || null;

    const document = await this.documentsService.submitDocument(
      {
        title,
        content,
        workspaceId: effectiveWorkspaceId,
      },
      effectiveWorkspaceId,
    );

    return {
      message: 'Document uploaded and queued for ingestion',
      id: document.id,
      status: document.status,
      workspaceId: document.workspaceId,
    };
  }

  @Get()
  @ApiOperation({ summary: 'List all documents with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: ['ASC', 'DESC'],
    example: 'DESC',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of documents',
    type: PaginatedResponseDto,
  })
  async findAll(
    @Query() paginationDto: PaginationDto,
    @CurrentWorkspaceId() workspaceId: string | null,
  ) {
    return this.documentsService.findAll(paginationDto, workspaceId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Poll a specific document by ID to check ingestion status',
  })
  async findOne(
    @Param('id') id: string,
    @CurrentWorkspaceId() workspaceId: string | null,
  ) {
    const document = await this.documentsService.findOne(id, workspaceId);
    return {
      id: document.id,
      title: document.title,
      status: document.status,
      workspaceId: document.workspaceId,
      failureReason: document.failureReason,
      createdAt: document.createdAt,
    };
  }

  @Sse(':id/progress')
  @ApiOperation({
    summary:
      'Stream real-time document ingestion progress via Server-Sent Events (SSE)',
  })
  @ApiResponse({
    status: 200,
    description:
      'SSE stream delivering real-time progress events (PENDING -> CHUNKING 25% -> EMBEDDING 50..90% -> READY 100% / FAILED)',
  })
  @ApiResponse({
    status: 404,
    description: 'Document with the specified ID was not found',
  })
  streamProgress(@Param('id') id: string): Observable<MessageEvent> {
    return this.documentsService.getProgressStream(id);
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
  remove(
    @Param('id') id: string,
    @CurrentWorkspaceId() workspaceId: string | null,
  ) {
    return this.documentsService.remove(id, workspaceId);
  }
}
