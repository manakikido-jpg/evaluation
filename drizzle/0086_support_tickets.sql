CREATE TABLE "support_tickets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type_key" text NOT NULL,
	"opener_id" text NOT NULL,
	"channel_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_id" text,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"role_id" text,
	"members" text[] DEFAULT '{}'::text[] NOT NULL,
	"quote_price" integer,
	"quote_deadline" text,
	"quote_by" text,
	"escrow" integer DEFAULT 0 NOT NULL,
	"paid_to" text,
	"last_user_at" timestamp with time zone,
	"last_staff_at" timestamp with time zone,
	"stale_notified_at" timestamp with time zone,
	"idle_warned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"close_reason" text,
	"transcript" text,
	"rating" integer,
	CONSTRAINT "support_tickets_escrow" CHECK ("support_tickets"."escrow" >= 0)
);
--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "support_tickets_opener_idx" ON "support_tickets" USING btree ("opener_id","type_key");