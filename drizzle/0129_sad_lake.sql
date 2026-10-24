CREATE TABLE "koban_purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_id" bigint NOT NULL,
	"member_id" text NOT NULL,
	"face_value" integer NOT NULL,
	"price" integer NOT NULL,
	"fee" integer NOT NULL,
	"target_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koban_value_check" CHECK ("koban_purchases"."face_value" in (1000, 3000, 5000, 10000)),
	CONSTRAINT "koban_price_check" CHECK ("koban_purchases"."price" = "koban_purchases"."face_value" * 3 / 2 and "koban_purchases"."fee" = "koban_purchases"."price" - "koban_purchases"."face_value"),
	CONSTRAINT "koban_sent_check" CHECK (("koban_purchases"."sent_at" is null and "koban_purchases"."target_id" is null) or ("koban_purchases"."sent_at" is not null and "koban_purchases"."target_id" is not null and "koban_purchases"."target_id" <> "koban_purchases"."member_id"))
);
--> statement-breakpoint
ALTER TABLE "koban_purchases" ADD CONSTRAINT "koban_purchases_purchase_id_shop_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."shop_purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "koban_owner_idx" ON "koban_purchases" USING btree ("member_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "koban_shop_purchase_idx" ON "koban_purchases" USING btree ("purchase_id");