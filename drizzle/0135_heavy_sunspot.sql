CREATE TABLE "cast_charge_quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"action_key" text,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"prices" jsonb NOT NULL,
	"session_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cast_charge_quotes_action_key_unique" UNIQUE("action_key")
);
--> statement-breakpoint
ALTER TABLE "cast_sessions" ADD COLUMN "base_extension_price" integer;--> statement-breakpoint
CREATE INDEX "cast_charge_quote_expiry_idx" ON "cast_charge_quotes" USING btree ("expires_at");