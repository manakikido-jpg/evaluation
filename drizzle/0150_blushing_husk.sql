CREATE TABLE "shofuku_achievements" (
	"inviter_id" text PRIMARY KEY NOT NULL,
	"points" integer NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"awarded_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shofuku_entries" (
	"member_id" text PRIMARY KEY NOT NULL,
	"inviter_id" text NOT NULL,
	"omairi_extended_at" timestamp with time zone,
	"rewarded_at" timestamp with time zone,
	"reward" integer DEFAULT 0 NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"decided_by" text
);
