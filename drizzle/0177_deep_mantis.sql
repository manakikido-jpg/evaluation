CREATE TABLE "yakubarai_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"price" integer NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "yakubarai_waiting_uq" ON "yakubarai_requests" USING btree ("member_id") WHERE "yakubarai_requests"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "yakubarai_member_idx" ON "yakubarai_requests" USING btree ("member_id","created_at");--> statement-breakpoint
UPDATE "shop_items" SET "name" = '厄祓い', "emoji" = '🙏', "description" = '厄を祓う申し込み（買うと面接待ちになり、運営との面接のあとに祓われます）' WHERE "kind" = 'menzaifu' AND "name" = '免罪符';
