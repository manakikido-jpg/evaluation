CREATE TABLE "interviews" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"place_channel_id" text,
	"place_text" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"template_name" text NOT NULL,
	"template" text NOT NULL,
	"channel_id" text NOT NULL,
	"post_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"message_id" text,
	"posted_at" timestamp with time zone,
	"remind_60" boolean DEFAULT true NOT NULL,
	"remind_10" boolean DEFAULT true NOT NULL,
	"remind_60_at" timestamp with time zone,
	"remind_10_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "interviews_at_idx" ON "interviews" USING btree ("at");--> statement-breakpoint
CREATE INDEX "interviews_status_idx" ON "interviews" USING btree ("status","post_at");