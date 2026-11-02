CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task" varchar(32) NOT NULL,
	"provider" varchar(40),
	"model" varchar(80),
	"outcome" varchar(8) NOT NULL,
	"fallback" boolean DEFAULT false NOT NULL,
	"error" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"ms" integer NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_calls_created_idx" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_task_created_idx" ON "llm_calls" USING btree ("task","created_at");