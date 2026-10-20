ALTER TABLE "core_time_attendance" ADD COLUMN "bonus" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "core_time_attendance" ADD COLUMN "bonus_at" timestamp with time zone;