CREATE TABLE "minutes_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"nonce" text NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"body" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"generation_id" text,
	"generation_started_at" timestamp with time zone,
	"generated_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "minutes_documents_nonce_idx" ON "minutes_documents" USING btree ("guild_id","nonce");--> statement-breakpoint
CREATE INDEX "minutes_documents_updated_idx" ON "minutes_documents" USING btree ("guild_id","updated_at");