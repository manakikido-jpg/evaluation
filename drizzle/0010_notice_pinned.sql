ALTER TABLE "notices" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "posted_pinned" boolean DEFAULT false NOT NULL;