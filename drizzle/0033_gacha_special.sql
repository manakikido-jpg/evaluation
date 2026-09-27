CREATE TABLE "gacha_claims" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"prize_id" bigint,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"delivered_by" text
);
--> statement-breakpoint
ALTER TABLE "gacha_prizes" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "gacha_prizes" ADD COLUMN "stock" integer;--> statement-breakpoint
CREATE INDEX "gacha_claims_created_idx" ON "gacha_claims" USING btree ("created_at");