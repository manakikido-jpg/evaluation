CREATE TABLE "casino_tables" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"host_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"state" jsonb NOT NULL,
	"seat_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "casino_tables_status_idx" ON "casino_tables" USING btree ("status","kind");