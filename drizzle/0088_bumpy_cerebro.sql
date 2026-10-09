CREATE TABLE "slot_seats" (
	"machine" integer PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"played_at" timestamp with time zone NOT NULL,
	"away_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "slot_at_machines" ADD COLUMN "away_until" timestamp with time zone;