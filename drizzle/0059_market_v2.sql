CREATE TABLE "market_bids" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" bigint NOT NULL,
	"seller_id" text NOT NULL,
	"amount" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"order_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_bids_amount" CHECK ("market_bids"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "market_offers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"listing_id" bigint NOT NULL,
	"buyer_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"amount" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"order_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "market_offers_amount" CHECK ("market_offers"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "market_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"requester_id" text NOT NULL,
	"category" text NOT NULL,
	"subcategory" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"budget" integer NOT NULL,
	"image_url" text,
	"status" text DEFAULT 'open' NOT NULL,
	"channel_id" text,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_requests_budget" CHECK ("market_requests"."budget" > 0)
);
--> statement-breakpoint
ALTER TABLE "market_listings" ADD COLUMN "pricing" text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_listings" ADD COLUMN "subcategory" text;--> statement-breakpoint
ALTER TABLE "market_listings" ADD COLUMN "capacity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "market_listings" ADD COLUMN "standby_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "market_listings" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "request_id" bigint;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "dispute_kind" text;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "review" text;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "rated_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "market_bids_one_idx" ON "market_bids" USING btree ("request_id","seller_id");--> statement-breakpoint
CREATE INDEX "market_offers_listing_idx" ON "market_offers" USING btree ("listing_id","status");--> statement-breakpoint
CREATE INDEX "market_requests_status_idx" ON "market_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "market_orders_seller_idx" ON "market_orders" USING btree ("seller_id");