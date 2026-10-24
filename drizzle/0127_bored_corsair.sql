CREATE TABLE "gallery_rewards" (
	"message_id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"member_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"day" text NOT NULL,
	"week" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"attachment_ids" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"checked_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "gallery_rewards_due_idx" ON "gallery_rewards" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "gallery_rewards_member_week_idx" ON "gallery_rewards" USING btree ("member_id","week");