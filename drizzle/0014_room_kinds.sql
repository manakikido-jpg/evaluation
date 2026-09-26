ALTER TABLE "temp_voice" ADD COLUMN "kind" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "temp_voice" ADD COLUMN "paid" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "temp_voice" ADD COLUMN "paid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "temp_voice" ADD COLUMN "unpaid_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "temp_voice" ADD COLUMN "invited" text[] DEFAULT '{}'::text[] NOT NULL;