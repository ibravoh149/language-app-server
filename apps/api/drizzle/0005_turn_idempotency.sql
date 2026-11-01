ALTER TABLE "session_turns" ADD COLUMN "client_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "session_turns" ADD COLUMN "response" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "session_turns_client_turn_idx" ON "session_turns" USING btree ("session_id","client_turn_id");