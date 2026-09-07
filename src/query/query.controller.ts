import {
  Controller,
  Post,
  Body,
  Query,
  Sse,
  Res,
  UseGuards,
  MessageEvent,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import type { Response } from 'express';
import { QueryService } from './query.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { AnswerService } from './answer.service';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentWorkspaceId } from '../auth/decorators/current-workspace.decorator';

@ApiTags('Query & Retrieval')
@Controller('query')
@UseGuards(ThrottlerGuard)
export class QueryController {
  constructor(
    private readonly queryService: QueryService,
    private readonly answerService: AnswerService,
  ) {}

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search the knowledge base using semantic vector similarity',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the most relevant text chunks',
  })
  async search(
    @Body() dto: SearchQueryDto,
    @CurrentWorkspaceId() workspaceId: string | null,
  ) {
    const effectiveWorkspaceId = workspaceId || dto.workspaceId || null;
    const results = await this.queryService.search(dto, effectiveWorkspaceId);
    return {
      query: dto.query,
      workspaceId: effectiveWorkspaceId,
      count: results.length,
      results,
    };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('ask')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask a question and get an AI-generated answer with citations',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the generated answer and source citations',
  })
  async ask(
    @Body() dto: SearchQueryDto,
    @CurrentWorkspaceId() workspaceId: string | null,
  ) {
    const effectiveWorkspaceId = workspaceId || dto.workspaceId || null;
    return this.answerService.askQuestion(dto, effectiveWorkspaceId);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Sse('ask/stream')
  @ApiOperation({
    summary: 'Stream RAG answer token-by-token via SSE (GET)',
  })
  @ApiQuery({
    name: 'query',
    required: true,
    type: String,
    description: 'The question to ask the knowledge base',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of matching chunks to return',
  })
  @ApiQuery({
    name: 'workspaceId',
    required: false,
    type: String,
    description: 'Optional workspace UUID for tenant scoping',
  })
  @ApiResponse({
    status: 200,
    description:
      'SSE stream delivering citations, incremental tokens, and completion event',
  })
  askStream(
    @Query() dto: SearchQueryDto,
    @CurrentWorkspaceId() workspaceId: string | null,
  ): Observable<MessageEvent> {
    const effectiveWorkspaceId = workspaceId || dto.workspaceId || null;
    return this.answerService.askQuestionStream(dto, effectiveWorkspaceId);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('ask/stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stream RAG answer token-by-token via SSE (POST body)',
  })
  @ApiResponse({
    status: 200,
    description:
      'SSE stream delivering citations, incremental tokens, and completion event',
  })
  askStreamPost(
    @Body() dto: SearchQueryDto,
    @Res() res: Response,
    @CurrentWorkspaceId() workspaceId: string | null,
  ): void {
    const effectiveWorkspaceId = workspaceId || dto.workspaceId || null;
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const subscription = this.answerService
      .askQuestionStream(dto, effectiveWorkspaceId)
      .subscribe({
        next: (event) => {
          res.write(`data: ${JSON.stringify(event.data)}\n\n`);
        },
        error: (err: unknown) => {
          const errorMsg =
            err instanceof Error
              ? err.message
              : 'Internal error during streaming';
          res.write(
            `data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`,
          );
          res.end();
        },
        complete: () => {
          res.end();
        },
      });

    res.on('close', () => {
      subscription.unsubscribe();
    });
  }
}
