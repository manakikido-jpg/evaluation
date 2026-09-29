ALTER TABLE "board_entries" ADD COLUMN "thread_id" text;--> statement-breakpoint
ALTER TABLE "board_posts" ADD COLUMN "apply_thread_id" text;