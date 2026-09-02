export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    embeddingDimensions: parseInt(
      process.env.EMBEDDING_DIMENSIONS || '1536',
      10,
    ),
    chatModel: process.env.CHAT_MODEL || 'gpt-4o-mini',
  },
  chunking: {
    size: parseInt(process.env.CHUNK_SIZE_CHARS || '1200', 10),
    overlap: parseInt(process.env.CHUNK_OVERLAP_CHARS || '200', 10),
  },
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL || '60000', 10),
    limit: parseInt(process.env.RATE_LIMIT_MAX || '10', 10),
  },
});
