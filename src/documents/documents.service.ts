import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Document } from './document.entity';
import { Chunk } from './chunk.entity';
import { IngestDocumentDto } from './dto/ingest-document.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    @InjectRepository(Chunk)
    private readonly chunkRepo: Repository<Chunk>,
    @InjectQueue('ingestion')
    private readonly ingestionQueue: Queue,
  ) {}

  async submitDocument(dto: IngestDocumentDto): Promise<Document> {
    // Save document to DB
    const document = this.documentRepo.create({
      title: dto.title,
      sourceContent: dto.content,
    });
    const savedDocument = await this.documentRepo.save(document);

    // Dispatch background job to the 'ingestion' queue
    await this.ingestionQueue.add('ingest-doc', {
      documentId: savedDocument.id,
    });

    return savedDocument;
  }

  async findAll(
    dto: PaginationDto = new PaginationDto(),
  ): Promise<PaginatedResponseDto<Document>> {
    const page = dto.page || 1;
    const limit = dto.limit || 10;
    const order = dto.order || 'DESC';
    const skip = (page - 1) * limit;

    const [data, totalItems] = await this.documentRepo.findAndCount({
      skip,
      take: limit,
      order: { createdAt: order },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        failureReason: true,
      },
    });

    return new PaginatedResponseDto(data, totalItems, page, limit);
  }

  async findOne(id: string): Promise<Document> {
    const document = await this.documentRepo.findOneBy({ id });
    if (!document) {
      throw new NotFoundException(`Document with ID ${id} not found`);
    }
    return document;
  }

  async remove(id: string): Promise<{ message: string; id: string }> {
    const document = await this.findOne(id);
    await this.chunkRepo.delete({ documentId: id });
    await this.documentRepo.delete(id);
    return {
      message: 'Document and associated chunks deleted successfully',
      id: document.id,
    };
  }
}
