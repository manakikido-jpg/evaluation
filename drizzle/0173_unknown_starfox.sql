ALTER TABLE "ticket_attachments" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "ticket_operations" ADD COLUMN "creation_id" text;--> statement-breakpoint
ALTER TABLE "ticket_operations" ADD COLUMN "archive_cursor" text;--> statement-breakpoint
ALTER TABLE "ticket_operations" ADD COLUMN "archive_complete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_operations" ADD CONSTRAINT "ticket_operations_creation_id_unique" UNIQUE("creation_id");