CREATE TABLE "economy_alerts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"member_id" text,
	"amount" integer DEFAULT 0 NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "economy_alerts_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "economy_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"value" integer NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"announce_channel_id" text,
	"start_notified" boolean DEFAULT false NOT NULL,
	"end_notified" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "economy_alerts_created_idx" ON "economy_alerts" USING btree ("created_at");