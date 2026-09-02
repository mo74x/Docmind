import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { QueryService } from './query.service';
import { SearchQueryDto } from './dto/search-query.dto';

@ApiTags('Query & Retrieval')
@Controller('query')
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

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
}
