import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { QueryService } from './query.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { AnswerService } from './answer.service';
@ApiTags('Query & Retrieval')
@Controller('query')
export class QueryController {
  constructor(
    private readonly queryService: QueryService,
    private readonly answerService: AnswerService,
  ) {}

  @Post('search')
  @ApiOperation({
    summary: 'Search the knowledge base using semantic vector similarity',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the most relevant text chunks',
  })
  async search(@Body() dto: SearchQueryDto) {
    const results = await this.queryService.search(dto);
    return {
      query: dto.query,
      count: results.length,
      results,
    };
  }
  @Post('ask')
  @ApiOperation({
    summary: 'Ask a question and get an AI-generated answer with citations',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the generated answer and source citations',
  })
  async ask(@Body() dto: SearchQueryDto) {
    return this.answerService.askQuestion(dto);
  }
}
