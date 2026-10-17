CREATE TABLE "recordings" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"status" text NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"next_seq" integer DEFAULT 0 NOT NULL,
	"last_hash" text,
	"max_bytes" integer NOT NULL,
	"channel_id" text,
	"participant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "recordings_expiry_idx" ON "recordings" USING btree ("expires_at");