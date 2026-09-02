import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Document } from './document.entity';
import { IngestDocumentDto } from './dto/ingest-document.dto';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
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

  async findAll(): Promise<Document[]> {
    return this.documentRepo.find({
      order: { createdAt: 'DESC' },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        failureReason: true,
      },
    });
  }

  async findOne(id: string): Promise<Document> {
    const document = await this.documentRepo.findOneBy({ id });
    if (!document) {
      throw new NotFoundException(`Document with ID ${id} not found`);
    }
    return document;
  }
}
