CREATE TABLE "applications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"kind" text NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"note" text,
	"channel_id" text,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "omairi" (
	"member_id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"extended_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ongoing' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "soudan" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_id" text,
	"channel_id" text,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "soudan_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"soudan_id" bigint NOT NULL,
	"from_role" text NOT NULL,
	"staff_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "soudan_senders" (
	"soudan_id" bigint PRIMARY KEY NOT NULL,
	"sender_id" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "applications_member_idx" ON "applications" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_one_pending" ON "applications" USING btree ("member_id","kind") WHERE "applications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "soudan_status_idx" ON "soudan" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "soudan_messages_idx" ON "soudan_messages" USING btree ("soudan_id","created_at");