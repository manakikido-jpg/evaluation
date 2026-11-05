CREATE TABLE "evaluation_time_deductions" (
	"member_id" text NOT NULL,
	"date" text NOT NULL,
	"channel_id" text NOT NULL,
	"minutes" integer NOT NULL,
	"reason" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_time_deductions_member_id_date_channel_id_pk" PRIMARY KEY("member_id","date","channel_id"),
	CONSTRAINT "evaluation_deduction_minutes" CHECK ("evaluation_time_deductions"."minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "voice_usage" ADD COLUMN "evaluation_recorded_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_usage" ADD COLUMN "evaluation_eligible_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_usage" ADD CONSTRAINT "voice_usage_evaluation_minutes" CHECK ("voice_usage"."evaluation_eligible_minutes" >= 0 and "voice_usage"."evaluation_eligible_minutes" <= "voice_usage"."evaluation_recorded_minutes" and "voice_usage"."evaluation_recorded_minutes" <= "voice_usage"."sanpaisha_minutes");