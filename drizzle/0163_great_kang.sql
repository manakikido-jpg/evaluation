CREATE TABLE "direct_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"amount" integer NOT NULL,
	"fee" integer NOT NULL,
	"total" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "direct_transfers_amount" CHECK ("direct_transfers"."amount" > 0 AND "direct_transfers"."amount" <= 1000000000),
	CONSTRAINT "direct_transfers_fee" CHECK ("direct_transfers"."fee" = ("direct_transfers"."amount" + 1) / 2 AND "direct_transfers"."total" = "direct_transfers"."amount" + "direct_transfers"."fee"),
	CONSTRAINT "direct_transfers_status" CHECK ("direct_transfers"."status" IN ('pending', 'sent', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX "direct_transfers_from_idx" ON "direct_transfers" USING btree ("from_id","created_at");