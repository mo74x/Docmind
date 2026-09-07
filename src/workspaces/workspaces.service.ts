import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Workspace } from './workspace.entity';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    @InjectRepository(Workspace)
    private readonly workspaceRepo: Repository<Workspace>,
  ) {}

  /**
   * Create a new workspace with unique slug and auto-generated API key if omitted.
   */
  async createWorkspace(dto: CreateWorkspaceDto): Promise<Workspace> {
    const slug = (
      dto.slug ||
      dto.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
    ).trim();

    // Check slug uniqueness
    const existingSlug = await this.workspaceRepo.findOneBy({ slug });
    if (existingSlug) {
      throw new ConflictException(
        `Workspace with slug "${slug}" already exists`,
      );
    }

    const apiKey =
      dto.apiKey?.trim() || `dcm_ws_${crypto.randomBytes(24).toString('hex')}`;

    // Check apiKey uniqueness
    const existingKey = await this.workspaceRepo.findOneBy({ apiKey });
    if (existingKey) {
      throw new ConflictException(`Workspace API key already in use`);
    }

    const workspace = this.workspaceRepo.create({
      name: dto.name.trim(),
      slug,
      apiKey,
    });

    const saved = await this.workspaceRepo.save(workspace);
    this.logger.log(
      `Created workspace "${saved.name}" (${saved.id}) with slug "${saved.slug}"`,
    );
    return saved;
  }

  /**
   * Retrieve all workspaces.
   */
  async findAll(): Promise<Workspace[]> {
    return this.workspaceRepo.find({
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Retrieve a single workspace by ID.
   */
  async findById(id: string): Promise<Workspace> {
    const workspace = await this.workspaceRepo.findOneBy({ id });
    if (!workspace) {
      throw new NotFoundException(`Workspace with ID ${id} not found`);
    }
    return workspace;
  }

  /**
   * Retrieve a workspace by its unique slug.
   */
  async findBySlug(slug: string): Promise<Workspace | null> {
    return this.workspaceRepo.findOneBy({ slug });
  }

  /**
   * Retrieve a workspace by its secret API key.
   */
  async findByApiKey(apiKey: string): Promise<Workspace | null> {
    return this.workspaceRepo.findOneBy({ apiKey });
  }

  /**
   * Delete a workspace by ID.
   */
  async deleteWorkspace(id: string): Promise<void> {
    const workspace = await this.findById(id);
    await this.workspaceRepo.remove(workspace);
    this.logger.log(`Deleted workspace "${workspace.name}" (${id})`);
  }
}
