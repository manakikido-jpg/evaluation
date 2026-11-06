CREATE TABLE "member_alts" (
	"alt_id" text PRIMARY KEY NOT NULL,
	"main_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "member_alts_main_idx" ON "member_alts" USING btree ("main_id");