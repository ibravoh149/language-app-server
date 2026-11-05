DROP INDEX "dictionary_aliases_key_idx";--> statement-breakpoint
DROP INDEX "dictionary_entries_key_idx";--> statement-breakpoint
ALTER TABLE "dictionary_aliases" ADD COLUMN "target_language" varchar(5) DEFAULT 'de' NOT NULL;--> statement-breakpoint
ALTER TABLE "dictionary_entries" ADD COLUMN "target_language" varchar(5) DEFAULT 'de' NOT NULL;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "target_language" varchar(5) DEFAULT 'de' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dictionary_aliases_key_idx" ON "dictionary_aliases" USING btree ("surface_key","target_language","meaning_language");--> statement-breakpoint
CREATE UNIQUE INDEX "dictionary_entries_key_idx" ON "dictionary_entries" USING btree ("lemma_key","target_language","meaning_language");