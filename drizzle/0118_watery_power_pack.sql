ALTER TABLE "update_posts" ADD COLUMN "style" text DEFAULT 'embed' NOT NULL;--> statement-breakpoint
ALTER TABLE "update_posts" ADD COLUMN "image_type" text;--> statement-breakpoint
ALTER TABLE "update_posts" ADD COLUMN "image_data" "bytea";--> statement-breakpoint
ALTER TABLE "update_posts" ADD COLUMN "image_hash" text;--> statement-breakpoint
ALTER TABLE "update_posts" ADD COLUMN "image_position" text DEFAULT 'bottom' NOT NULL;