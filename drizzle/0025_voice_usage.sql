CREATE TABLE "voice_channels" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category_id" text,
	"category_name" text,
	"hub_id" text,
	"owner_id" text,
	"kind" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_pairs" (
	"member_a" text NOT NULL,
	"member_b" text NOT NULL,
	"date" text NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "voice_pairs_member_a_member_b_date_pk" PRIMARY KEY("member_a","member_b","date")
);
--> statement-breakpoint
CREATE TABLE "voice_usage" (
	"member_id" text NOT NULL,
	"date" text NOT NULL,
	"channel_id" text NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "voice_usage_member_id_date_channel_id_pk" PRIMARY KEY("member_id","date","channel_id")
);
--> statement-breakpoint
CREATE INDEX "voice_pairs_b_idx" ON "voice_pairs" USING btree ("member_b");--> statement-breakpoint
CREATE INDEX "voice_pairs_date_idx" ON "voice_pairs" USING btree ("date");--> statement-breakpoint
CREATE INDEX "voice_usage_date_idx" ON "voice_usage" USING btree ("date");