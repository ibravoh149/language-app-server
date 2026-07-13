import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

// Load .env from monorepo root when running db:* scripts from apps/api/
config({ path: '../../.env' });

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
