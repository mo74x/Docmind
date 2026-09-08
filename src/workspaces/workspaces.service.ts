import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { Workspace } from './workspace.entity';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';

const PREFIX_LENGTH = 15;

function getApiKeyPrefix(key: string): string {
  return key.slice(0, Math.min(key.length, PREFIX_LENGTH));
}

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    @InjectRepository(Workspace)
    private readonly workspaceRepo: Repository<Workspace>,
  ) {}

  /**
   * Create a new workspace with unique slug and auto-generated API key if omitted.
   * Stores hashed API key and prefix for secure identification.
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

    const rawApiKey =
      dto.apiKey?.trim() || `dcm_ws_${crypto.randomBytes(24).toString('hex')}`;
    const apiKeyPrefix = getApiKeyPrefix(rawApiKey);

    // Check if key is already in use by candidates with same prefix
    const existingCandidates = await this.workspaceRepo.find({
      where: { apiKeyPrefix },
    });
    for (const candidate of existingCandidates) {
      if (
        candidate.apiKeyHash &&
        (await bcrypt.compare(rawApiKey, candidate.apiKeyHash))
      ) {
        throw new ConflictException(`Workspace API key already in use`);
      }
    }

    const apiKeyHash = await bcrypt.hash(rawApiKey, 12);

    const workspace = this.workspaceRepo.create({
      name: dto.name.trim(),
      slug,
      apiKeyHash,
      apiKeyPrefix,
    });

    const saved = await this.workspaceRepo.save(workspace);
    // Attach raw API key in-memory once so the caller receives it upon creation
    saved.apiKey = rawApiKey;
    delete saved.apiKeyHash;

    this.logger.log(
      `Created workspace "${saved.name}" (${saved.id}) with slug "${saved.slug}"`,
    );
    return saved;
  }

  /**
   * Retrieve all workspaces.
   */
  async findAll(): Promise<Workspace[]> {
    const workspaces = await this.workspaceRepo.find({
      order: { createdAt: 'DESC' },
    });
    workspaces.forEach((w) => delete w.apiKeyHash);
    return workspaces;
  }

  /**
   * Retrieve a single workspace by ID.
   */
  async findById(id: string): Promise<Workspace> {
    const workspace = await this.workspaceRepo.findOneBy({ id });
    if (!workspace) {
      throw new NotFoundException(`Workspace with ID ${id} not found`);
    }
    delete workspace.apiKeyHash;
    return workspace;
  }

  /**
   * Retrieve a workspace by its unique slug.
   */
  async findBySlug(slug: string): Promise<Workspace | null> {
    const workspace = await this.workspaceRepo.findOneBy({ slug });
    if (workspace) {
      delete workspace.apiKeyHash;
    }
    return workspace;
  }

  /**
   * Retrieve a workspace by its secret API key.
   * Compares provided key against hashed keys in the database.
   */
  async findByApiKey(apiKey: string): Promise<Workspace | null> {
    if (!apiKey || typeof apiKey !== 'string') {
      return null;
    }

    const apiKeyPrefix = getApiKeyPrefix(apiKey);
    const candidates = await this.workspaceRepo.find({
      where: { apiKeyPrefix },
    });

    for (const candidate of candidates) {
      if (candidate.apiKeyHash) {
        const isMatch = await bcrypt.compare(apiKey, candidate.apiKeyHash);
        if (isMatch) {
          delete candidate.apiKeyHash;
          return candidate;
        }
      }
    }

    return null;
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
