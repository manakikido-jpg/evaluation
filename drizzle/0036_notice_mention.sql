ALTER TABLE "notices" ADD COLUMN "mention" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "posted_mention" text;