CREATE TABLE "message_archive" (
	"message_id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"author_id" text NOT NULL,
	"author_name" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"edits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
CREATE TABLE "message_archive_files" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "message_archive_author_idx" ON "message_archive" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "message_archive_created_idx" ON "message_archive" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "message_archive_channel_idx" ON "message_archive" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "message_archive_files_msg_idx" ON "message_archive_files" USING btree ("message_id");