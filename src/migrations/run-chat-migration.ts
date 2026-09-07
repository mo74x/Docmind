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
    console.log('Connected to DB for Chat migration');

    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title varchar(255) NOT NULL DEFAULT 'New Chat',
        "workspaceId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      );
    `);
    console.log('Verified table chat_sessions.');

    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "sessionId" uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role varchar(32) NOT NULL DEFAULT 'user',
        content text NOT NULL,
        sources jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      );
    `);
    console.log('Verified table chat_messages.');

    await client.query(`
      CREATE INDEX IF NOT EXISTS chat_messages_session_idx 
      ON chat_messages ("sessionId");
    `);
    console.log('Verified index chat_messages_session_idx.');

    console.log('Chat migration successfully completed.');
  } catch (error) {
    console.error('Chat migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void run();
