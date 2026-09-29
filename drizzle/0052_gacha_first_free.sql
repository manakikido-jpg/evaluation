CREATE TABLE "gacha_first_free" (
	"member_id" text PRIMARY KEY NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- もう引いたことのある人は、はじめての 1 回を使ったことにする
INSERT INTO "gacha_first_free" ("member_id", "used_at") SELECT "member_id", now() FROM "gacha_state" WHERE "total" > 0 ON CONFLICT DO NOTHING;
