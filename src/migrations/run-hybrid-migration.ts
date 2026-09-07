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
    console.log('Connected to DB for Hybrid Search migration');

    // Add generated tsvector column for full-text lexical search
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='chunks' AND column_name='tsv'
        ) THEN
          ALTER TABLE chunks 
          ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
        END IF;
      END $$;
    `);
    console.log('Added tsv generated column.');

    // Create GIN index for ultra-fast full-text search
    await client.query(`
      CREATE INDEX IF NOT EXISTS chunks_tsv_idx 
      ON chunks USING gin(tsv);
    `);
    console.log('Created GIN index chunks_tsv_idx.');
  } catch (error) {
    console.error('Hybrid migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void run();
