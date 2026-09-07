import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { Workspace } from './workspace.entity';

@ApiTags('Workspaces & Multi-Tenancy')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new isolated workspace tenant' })
  @ApiResponse({
    status: 201,
    description: 'Workspace created successfully with scoped secret API key',
    type: Workspace,
  })
  @ApiResponse({
    status: 409,
    description: 'Workspace slug or API key conflict',
  })
  async createWorkspace(@Body() dto: CreateWorkspaceDto): Promise<Workspace> {
    return this.workspacesService.createWorkspace(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all workspaces' })
  @ApiResponse({
    status: 200,
    description: 'Returns all configured workspaces',
    type: [Workspace],
  })
  async findAll(): Promise<Workspace[]> {
    return this.workspacesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get workspace details by ID' })
  @ApiParam({ name: 'id', description: 'Workspace UUID' })
  @ApiResponse({
    status: 200,
    description: 'Returns the workspace entity',
    type: Workspace,
  })
  @ApiResponse({ status: 404, description: 'Workspace not found' })
  async findById(@Param('id', ParseUUIDPipe) id: string): Promise<Workspace> {
    return this.workspacesService.findById(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a workspace' })
  @ApiParam({ name: 'id', description: 'Workspace UUID' })
  @ApiResponse({ status: 204, description: 'Workspace deleted successfully' })
  @ApiResponse({ status: 404, description: 'Workspace not found' })
  async deleteWorkspace(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.workspacesService.deleteWorkspace(id);
  }
}
