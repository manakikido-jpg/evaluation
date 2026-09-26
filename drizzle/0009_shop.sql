CREATE TABLE "shop_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"emoji" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"role_id" text,
	"role_group" text,
	"duration_days" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_items_price" CHECK ("shop_items"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shop_purchases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"item_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"price" integer NOT NULL,
	"role_id" text,
	"target_id" text,
	"channel_id" text,
	"message_id" text,
	"expires_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "shop_purchases_member_idx" ON "shop_purchases" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "shop_purchases_expires_idx" ON "shop_purchases" USING btree ("expires_at");