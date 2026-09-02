import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { QueryService } from './query.service';
import { SearchQueryDto } from './dto/search-query.dto';

@Injectable()
export class AnswerService {
  private readonly openai: OpenAI;
  private readonly logger = new Logger(AnswerService.name);
  private readonly model: string;

  constructor(
    private configService: ConfigService,
    private queryService: QueryService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('openai.apiKey'),
    });
    this.model =
      this.configService.get<string>('openai.chatModel') || 'gpt-4o-mini';
  }

  async askQuestion(dto: SearchQueryDto) {
    this.logger.log(`Generating answer for: "${dto.query}"`);

    // Retrieve the most relevant chunks using Phase 2 logic
    const searchResults = await this.queryService.search(dto);

    if (!searchResults.length) {
      return {
        query: dto.query,
        answer: "I don't have any ingested documents to answer this question.",
        sources: [],
      };
    }

    // Format the retrieved chunks into a numbered list
    const formattedContext = searchResults
      .map((result, index) => {
        return `[Source ${index + 1}] (Document: ${result.documentTitle}):\n${result.content}`;
      })
      .join('\n\n---\n\n');

    // Construct the grounded prompt
    const systemPrompt = `You are a highly precise knowledge-base assistant. Answer the user's question using ONLY the provided sources below.

RULES:
1. For every factual claim you make, you MUST cite the source inline as [Source N] where N is the source number.
2. Do not use outside knowledge. Do not hallucinate information.
3. If the provided sources do not contain the answer, respond exactly with: "The provided documents don't contain the answer to this question."

SOURCES:
${formattedContext}`;

    // Call OpenAI Chat Completions API
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: dto.query },
      ],
      // Low temperature ensures the model remains factual and sticks to the provided text
      temperature: 0.1,
    });

    const answer = response.choices[0].message.content;

    // Return the generated answer alongside the citation map so the frontend can build clickable links
    return {
      query: dto.query,
      answer,
      sources: searchResults.map((res, i) => ({
        citation: `[Source ${i + 1}]`,
        documentTitle: res.documentTitle,
        chunkId: res.chunkId,
        similarity: res.similarity,
      })),
    };
  }
}
