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
  let updated = 0;
  for (const [spokenLanguage, levels] of Object.entries(PLACEMENT_PROMPTS)) {
    for (const [level, texts] of Object.entries(levels)) {
      for (const [index, text] of texts.entries()) {
        // The German list is the reference translation, in the same order.
        const referenceText = PLACEMENT_PROMPTS.de[level as keyof typeof PLACEMENT_PROMPTS.de][index] ?? null;
        const [existing] = await db
          .select({ id: placementPrompts.id, referenceText: placementPrompts.referenceText })
          .from(placementPrompts)
          .where(and(eq(placementPrompts.spokenLanguage, spokenLanguage), eq(placementPrompts.text, text)))
          .limit(1);
        if (existing) {
          if (!existing.referenceText && referenceText) {
            await db.update(placementPrompts).set({ referenceText }).where(eq(placementPrompts.id, existing.id));
            updated++;
          }
          continue;
        }
        await db.insert(placementPrompts).values({
          spokenLanguage,
          targetLanguage: 'de',
          level: level as (typeof schema.cefrLevel.enumValues)[number],
          text,
          referenceText,
        });
        inserted++;
      }
    }
  }
  console.log(`placement_prompts: ${inserted} inserted, ${updated} reference translations added`);
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
