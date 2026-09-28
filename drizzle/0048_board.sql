CREATE TABLE "board_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"post_id" bigint NOT NULL,
	"member_id" text NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hired_at" timestamp with time zone,
	"release_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"decided_by" text
);
--> statement-breakpoint
CREATE TABLE "board_posts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"slots" integer DEFAULT 1 NOT NULL,
	"reward" integer DEFAULT 0 NOT NULL,
	"escrow" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"channel_id" text,
	"message_id" text,
	"thread_id" text,
	"deadline_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "board_posts_reward" CHECK ("board_posts"."reward" >= 0 and "board_posts"."escrow" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "board_entries_post_member_idx" ON "board_entries" USING btree ("post_id","member_id");--> statement-breakpoint
CREATE INDEX "board_entries_status_idx" ON "board_entries" USING btree ("status","release_at");--> statement-breakpoint
CREATE INDEX "board_posts_status_idx" ON "board_posts" USING btree ("status","deadline_at");