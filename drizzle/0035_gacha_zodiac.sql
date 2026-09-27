CREATE TABLE "gacha_collection" (
	"member_id" text NOT NULL,
	"item" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gacha_collection_member_id_item_pk" PRIMARY KEY("member_id","item")
);
--> statement-breakpoint
ALTER TABLE "gacha_draws" ADD COLUMN "zodiac" text;--> statement-breakpoint
ALTER TABLE "gacha_prizes" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gacha_prizes" ADD COLUMN "ends_at" timestamp with time zone;