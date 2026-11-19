CREATE TABLE "engawa_pairs" (
	"member_a" text NOT NULL,
	"member_b" text NOT NULL,
	"date" text NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "engawa_pairs_member_a_member_b_date_pk" PRIMARY KEY("member_a","member_b","date")
);
--> statement-breakpoint
ALTER TABLE "activity_hourly" ADD COLUMN "engawa_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_usage" ADD COLUMN "engawa_unmute_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "engawa_pairs_b_idx" ON "engawa_pairs" USING btree ("member_b");--> statement-breakpoint
CREATE INDEX "engawa_pairs_date_idx" ON "engawa_pairs" USING btree ("date");--> statement-breakpoint
ALTER TABLE "voice_usage" ADD CONSTRAINT "voice_usage_engawa_unmute" CHECK ("voice_usage"."engawa_unmute_minutes" >= 0 and "voice_usage"."engawa_unmute_minutes" <= "voice_usage"."minutes");