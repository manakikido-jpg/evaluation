CREATE TABLE "visit_badges" (
	"member_id" text NOT NULL,
	"badge_id" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_badges_member_id_badge_id_pk" PRIMARY KEY("member_id","badge_id")
);
--> statement-breakpoint
CREATE TABLE "visit_daily" (
	"member_id" text NOT NULL,
	"date" text NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"last_minute" bigint NOT NULL,
	CONSTRAINT "visit_daily_member_id_date_pk" PRIMARY KEY("member_id","date"),
	CONSTRAINT "visit_minutes_range" CHECK ("visit_daily"."minutes" >= 0 and "visit_daily"."minutes" <= 1440)
);
--> statement-breakpoint
CREATE TABLE "visit_profiles" (
	"member_id" text PRIMARY KEY NOT NULL,
	"background" text DEFAULT 'paper' NOT NULL,
	"frame" text DEFAULT 'plain' NOT NULL,
	"title" text DEFAULT 'rank' NOT NULL,
	"badges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"public_stats" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_purchases" (
	"member_id" text NOT NULL,
	"item_id" text NOT NULL,
	"price" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_purchases_member_id_item_id_pk" PRIMARY KEY("member_id","item_id"),
	CONSTRAINT "visit_purchase_price" CHECK ("visit_purchases"."price" > 0)
);
