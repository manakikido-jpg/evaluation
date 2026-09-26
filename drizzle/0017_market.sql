CREATE TABLE "market_listings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"channel_id" text,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_listings_price" CHECK ("market_listings"."price" > 0)
);
--> statement-breakpoint
CREATE TABLE "market_orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"listing_id" bigint NOT NULL,
	"buyer_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"price" integer NOT NULL,
	"fee" integer NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"thread_id" text,
	"auto_release_at" timestamp with time zone NOT NULL,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "market_listings_seller_idx" ON "market_listings" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "market_orders_status_idx" ON "market_orders" USING btree ("status","auto_release_at");