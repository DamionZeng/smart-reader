import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
// Load .env.local first (Next.js convention), then fall back to .env.
dotenv.config({ path: '.env.local' });
dotenv.config();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
