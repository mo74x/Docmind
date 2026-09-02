/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Client } from 'pg';
import { config } from 'dotenv';
config();
async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in environment variables');
  }
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected to DB');

    await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
    console.log('Extension pgvector enabled.');
    await client.query(`
      ALTER TABLE chunks
      ADD COLUMN IF NOT EXISTS embedding vector(1536);
    `);
    console.log('Added embedding vector column.');

    // Create the ivfflat index for fast cosine-similarity search
    await client.query(`
      CREATE INDEX IF NOT EXISTS chunks_embedding_idx 
      ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    `);
    console.log('Created ivfflat index.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.end();
  }
}

void run();
