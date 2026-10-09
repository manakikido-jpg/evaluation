CREATE TABLE "long_voice_bonuses" (
	"member_id" text NOT NULL,
	"date" text NOT NULL,
	"week" text NOT NULL,
	"week_slot" integer NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"notify_claimed_at" timestamp with time zone,
	CONSTRAINT "long_voice_bonuses_member_id_date_pk" PRIMARY KEY("member_id","date"),
	CONSTRAINT "long_voice_bonus_slot_check" CHECK ("long_voice_bonuses"."week_slot" between 1 and 2)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "long_voice_bonus_week_slot_idx" ON "long_voice_bonuses" USING btree ("member_id","week","week_slot");