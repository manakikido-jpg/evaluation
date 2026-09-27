CREATE TABLE "bells" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"channel_id" text,
	"voice_channel_id" text,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"taken_by" text,
	"card_channel_id" text,
	"card_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_at" timestamp with time zone,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "bells_member_idx" ON "bells" USING btree ("member_id","created_at");