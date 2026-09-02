import { Module } from '@nestjs/common';
import { QueryService } from './query.service';
import { QueryController } from './query.controller';
import { AnswerService } from './answer.service';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import {
  makeCounterProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';

@Module({
  imports: [EmbeddingsModule],
  controllers: [QueryController],
  providers: [
    QueryService,
    AnswerService,
    makeCounterProvider({
      name: 'rag_queries_total',
      help: 'Total number of RAG queries received',
    }),
    makeCounterProvider({
      name: 'rag_cache_hits_total',
      help: 'Total number of RAG queries served from Redis cache',
    }),
    makeHistogramProvider({
      name: 'llm_generation_duration_seconds',
      help: 'Time spent waiting for the OpenAI Chat API',
      buckets: [0.5, 1, 2, 5, 10],
    }),
    makeHistogramProvider({
      name: 'vector_search_latency_seconds',
      help: 'Latency of vector similarity search in PostgreSQL',
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1],
    }),
  ],
})
export class QueryModule {}
