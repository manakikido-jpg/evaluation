CREATE TABLE "cast_sleep_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" bigint NOT NULL,
	"reporter_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	"calculation" jsonb NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cast_sessions" ADD COLUMN "attendance" jsonb;--> statement-breakpoint
ALTER TABLE "cast_sleep_reports" ADD CONSTRAINT "cast_sleep_reports_session_id_cast_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."cast_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cast_sleep_reports_session_idx" ON "cast_sleep_reports" USING btree ("session_id");