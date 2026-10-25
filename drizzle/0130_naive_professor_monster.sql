CREATE TABLE "market_web_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"action" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result_path" text,
	"target_kind" text,
	"target_id" bigint,
	"sync_status" text DEFAULT 'pending' NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "market_web_sync_idx" ON "market_web_actions" USING btree ("sync_status","created_at");