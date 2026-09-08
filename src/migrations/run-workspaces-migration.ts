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
    console.log('Connected to DB for Workspaces migration');

    // 1. Create workspaces table
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(255) NOT NULL,
        slug varchar(255) NOT NULL UNIQUE,
        "apiKeyHash" varchar(255) NOT NULL,
        "apiKeyPrefix" varchar(32) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      );
    `);

    // Ensure columns exist if table was previously created
    await client.query(`
      ALTER TABLE workspaces
      ADD COLUMN IF NOT EXISTS "apiKeyHash" varchar(255),
      ADD COLUMN IF NOT EXISTS "apiKeyPrefix" varchar(32);
    `);
    console.log('Verified table workspaces.');

    await client.query(`
      CREATE INDEX IF NOT EXISTS workspaces_slug_idx 
      ON workspaces (slug);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS workspaces_api_key_prefix_idx 
      ON workspaces ("apiKeyPrefix");
    `);
    console.log('Verified workspace indexes.');

    // 2. Add workspaceId column to documents if not exists
    await client.query(`
      ALTER TABLE documents 
      ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS documents_workspace_idx 
      ON documents ("workspaceId");
    `);
    console.log('Verified workspaceId column and index on documents.');

    // 3. Add workspaceId column to chunks if not exists
    await client.query(`
      ALTER TABLE chunks 
      ADD COLUMN IF NOT EXISTS "workspaceId" uuid;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS chunks_workspace_idx 
      ON chunks ("workspaceId");
    `);
    console.log('Verified workspaceId column and index on chunks.');

    // 4. Ensure index on chat_sessions workspaceId
    await client.query(`
      CREATE INDEX IF NOT EXISTS chat_sessions_workspace_idx 
      ON chat_sessions ("workspaceId");
    `);
    console.log('Verified workspaceId index on chat_sessions.');

    console.log('Workspaces migration successfully completed.');
  } catch (error) {
    console.error('Workspaces migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void run();
