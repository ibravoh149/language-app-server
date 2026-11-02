CREATE TABLE "dictionary_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"surface_key" varchar(80) NOT NULL,
	"meaning_language" varchar(5) NOT NULL,
	"entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dictionary_aliases" ADD CONSTRAINT "dictionary_aliases_entry_id_dictionary_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."dictionary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dictionary_aliases_key_idx" ON "dictionary_aliases" USING btree ("surface_key","meaning_language");