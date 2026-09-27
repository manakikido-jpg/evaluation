CREATE TABLE "gacha_prizes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"kind" text NOT NULL,
	"role_id" text,
	"ticket" text,
	"shop_item_id" integer,
	"amount" integer DEFAULT 1 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"fallback" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gacha_draws" ADD COLUMN "prize_id" bigint;--> statement-breakpoint
ALTER TABLE "gacha_draws" ADD COLUMN "shop_item_id" integer;--> statement-breakpoint
CREATE INDEX "gacha_prizes_tier_idx" ON "gacha_prizes" USING btree ("tier","position");