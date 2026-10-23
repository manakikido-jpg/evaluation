ALTER TABLE "update_posts" ADD COLUMN "mention" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "update_posts" ADD COLUMN "target_channel_id" text;