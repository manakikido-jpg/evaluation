ALTER TABLE "cast_sessions" ADD COLUMN "menu_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "casts" ADD COLUMN "menu" jsonb DEFAULT '[]'::jsonb NOT NULL;