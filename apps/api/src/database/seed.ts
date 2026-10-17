/**
 * Idempotent seed: inserts reference data that's missing, never duplicates or deletes.
 * Run with `yarn db:seed` (builds first, reads DATABASE_URL from .env).
 */
import { config } from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { placementPrompts } from './schema';
import { PLACEMENT_PROMPTS } from './seed-data/placement-prompts';

config({ path: ['.env', '../../.env'] });

async function seedPlacementPrompts(db: ReturnType<typeof drizzle<typeof schema>>) {
  let inserted = 0;
  for (const [spokenLanguage, levels] of Object.entries(PLACEMENT_PROMPTS)) {
    for (const [level, texts] of Object.entries(levels)) {
      for (const text of texts) {
        const exists = await db
          .select({ id: placementPrompts.id })
          .from(placementPrompts)
          .where(and(eq(placementPrompts.spokenLanguage, spokenLanguage), eq(placementPrompts.text, text)))
          .limit(1);
        if (exists.length) continue;
        await db.insert(placementPrompts).values({
          spokenLanguage,
          targetLanguage: 'de',
          level: level as (typeof schema.cefrLevel.enumValues)[number],
          text,
        });
        inserted++;
      }
    }
  }
  console.log(`placement_prompts: ${inserted} inserted`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = postgres(url, { max: 1 });
  try {
    await seedPlacementPrompts(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
