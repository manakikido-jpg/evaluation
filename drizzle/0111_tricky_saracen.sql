CREATE TABLE "cast_time_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" bigint NOT NULL,
	"proposed_by" text NOT NULL,
	"approve_by" text NOT NULL,
	"original_start_at" timestamp with time zone NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cast_time_changes" ADD CONSTRAINT "cast_time_changes_session_id_cast_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."cast_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cast_time_changes_session_idx" ON "cast_time_changes" USING btree ("session_id");