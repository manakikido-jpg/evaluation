CREATE TABLE "update_posts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"author_name" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"channel_id" text,
	"message_id" text
);
--> statement-breakpoint
CREATE INDEX "update_posts_status_idx" ON "update_posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "update_posts_author_idx" ON "update_posts" USING btree ("author_id");