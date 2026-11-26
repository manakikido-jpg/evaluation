CREATE TABLE "ticket_attachments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticket_id" bigint NOT NULL,
	"source_id" text NOT NULL,
	"source_url" text,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_try_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_attachments_size_check" CHECK ("ticket_attachments"."size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticket_id" bigint NOT NULL,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"body" text NOT NULL,
	"dedupe" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_notices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticket_id" bigint NOT NULL,
	"dedupe" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"target" text NOT NULL,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_try_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ticket_operations" (
	"ticket_id" bigint PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'unassigned' NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"policy" jsonb NOT NULL,
	"type_label" text NOT NULL,
	"role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"cycle" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_at" timestamp with time zone DEFAULT now() NOT NULL,
	"progress_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_reply_at" timestamp with time zone,
	"handoff_to" text,
	"handoff_by" text,
	"handoff_reason" text,
	"close_summary" text,
	"resolution_confirmed_at" timestamp with time zone,
	"retain_until" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"cleanup_channel_id" text,
	CONSTRAINT "ticket_operations_state_check" CHECK ("ticket_operations"."state" in ('unassigned','active','user_wait','internal_wait','closed'))
);
--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_notices" ADD CONSTRAINT "ticket_notices_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_operations" ADD CONSTRAINT "ticket_operations_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_attachments_source_idx" ON "ticket_attachments" USING btree ("ticket_id","source_id");--> statement-breakpoint
CREATE INDEX "ticket_attachments_ticket_idx" ON "ticket_attachments" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_events_ticket_idx" ON "ticket_events" USING btree ("ticket_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_events_dedupe_idx" ON "ticket_events" USING btree ("ticket_id","dedupe");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_notices_dedupe_idx" ON "ticket_notices" USING btree ("ticket_id","dedupe");--> statement-breakpoint
CREATE INDEX "ticket_notices_pending_idx" ON "ticket_notices" USING btree ("sent_at","next_try_at");--> statement-breakpoint
CREATE INDEX "ticket_operations_state_idx" ON "ticket_operations" USING btree ("state");--> statement-breakpoint
CREATE INDEX "ticket_operations_retention_idx" ON "ticket_operations" USING btree ("retain_until");