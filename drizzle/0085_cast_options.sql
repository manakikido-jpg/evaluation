ALTER TABLE "cast_sessions" ADD COLUMN "option_names" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "cast_sessions" ADD COLUMN "option_price" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "casts" ADD COLUMN "options" jsonb DEFAULT '[]'::jsonb NOT NULL;