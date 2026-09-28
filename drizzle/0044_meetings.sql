CREATE TABLE "meeting_todos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"meeting_id" bigint NOT NULL,
	"body" text NOT NULL,
	"assignee_id" text,
	"due" text,
	"done_at" timestamp with time zone,
	"done_by" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"held_at" timestamp with time zone NOT NULL,
	"place_channel_id" text,
	"attendees" text[] DEFAULT '{}'::text[] NOT NULL,
	"agenda" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"decisions" text DEFAULT '' NOT NULL,
	"posted_channel_id" text,
	"posted_message_id" text,
	"posted_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_todos" ADD CONSTRAINT "meeting_todos_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_todos_meeting_idx" ON "meeting_todos" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_todos_open_idx" ON "meeting_todos" USING btree ("done_at");--> statement-breakpoint
CREATE INDEX "meetings_held_at_idx" ON "meetings" USING btree ("held_at");