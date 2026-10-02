ALTER TABLE "gift_batches" ADD COLUMN "joined_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gift_batches" ADD COLUMN "member_ids" text[];