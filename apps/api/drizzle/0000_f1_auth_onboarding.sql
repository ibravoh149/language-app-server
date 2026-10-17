CREATE TYPE "public"."auth_provider" AS ENUM('apple', 'google');--> statement-breakpoint
CREATE TYPE "public"."cefr_level" AS ENUM('A1', 'A2', 'B1', 'B2', 'C1');--> statement-breakpoint
CREATE TYPE "public"."email_code_purpose" AS ENUM('verify_email', 'reset_password');--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "auth_provider" NOT NULL,
	"provider_user_id" text NOT NULL,
	"email" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "email_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "email_code_purpose" NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "placement_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_id" uuid NOT NULL,
	"user_id" uuid,
	"spoken_language" varchar(5) NOT NULL,
	"target_language" varchar(5) NOT NULL,
	"self_rated_level" "cefr_level",
	"transcript" text,
	"skipped" boolean DEFAULT false NOT NULL,
	"suggested_level" "cefr_level",
	"scored" boolean DEFAULT false NOT NULL,
	"reason" text,
	"strengths" jsonb,
	"focus_areas" jsonb,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "placement_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spoken_language" varchar(5) NOT NULL,
	"target_language" varchar(5) NOT NULL,
	"level" "cefr_level" NOT NULL,
	"text" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"interface_language" varchar(5) NOT NULL,
	"spoken_language" varchar(5) NOT NULL,
	"target_language" varchar(5) NOT NULL,
	"self_rated_level" "cefr_level",
	"suggested_level" "cefr_level",
	"chosen_level" "cefr_level" NOT NULL,
	"daily_minutes" integer NOT NULL,
	"reminder_enabled" boolean NOT NULL,
	"reminder_time" varchar(5) NOT NULL,
	"voice_id" text NOT NULL,
	"voice_speed" real NOT NULL,
	"assessment_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" text,
	"password_hash" text,
	"email_verified_at" timestamp with time zone,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_codes" ADD CONSTRAINT "email_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_attempts" ADD CONSTRAINT "placement_attempts_prompt_id_placement_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."placement_prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_attempts" ADD CONSTRAINT "placement_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_assessment_id_placement_attempts_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."placement_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_provider_user_idx" ON "auth_identities" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "auth_identities_user_idx" ON "auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_codes_user_purpose_idx" ON "email_codes" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "placement_prompts_lookup_idx" ON "placement_prompts" USING btree ("spoken_language","target_language","level");