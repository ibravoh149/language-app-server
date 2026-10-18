CREATE TYPE "public"."turn_role" AS ENUM('user', 'ai');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(24) NOT NULL,
	"ref_type" varchar(32),
	"ref_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"turn_id" uuid,
	"original" text NOT NULL,
	"corrected" text NOT NULL,
	"rule_key" varchar(80) NOT NULL,
	"rule_name" text NOT NULL,
	"explanation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(60) NOT NULL,
	"title" text NOT NULL,
	"subtitle" text NOT NULL,
	"emoji" varchar(16) NOT NULL,
	"level" "cefr_level" NOT NULL,
	"estimated_minutes" integer NOT NULL,
	"situation" text NOT NULL,
	"you_are" text NOT NULL,
	"ai_is" text NOT NULL,
	"ai_persona" text NOT NULL,
	"opening_line" text NOT NULL,
	"goals" jsonb NOT NULL,
	"words" jsonb NOT NULL,
	"phrases" jsonb NOT NULL,
	"grammar" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenarios_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" "turn_role" NOT NULL,
	"text" text NOT NULL,
	"input_mode" varchar(8),
	"understood" boolean,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "speaking_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"understood_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "streaks" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current" integer DEFAULT 0 NOT NULL,
	"longest" integer DEFAULT 0 NOT NULL,
	"last_produced_date" varchar(10),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_session_id_speaking_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."speaking_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_turn_id_session_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."session_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_turns" ADD CONSTRAINT "session_turns_session_id_speaking_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."speaking_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaking_sessions" ADD CONSTRAINT "speaking_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaking_sessions" ADD CONSTRAINT "speaking_sessions_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_user_time_idx" ON "activity_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "corrections_session_idx" ON "corrections" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "corrections_user_idx" ON "corrections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_turns_session_idx" ON "session_turns" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "speaking_sessions_user_idx" ON "speaking_sessions" USING btree ("user_id");