ALTER TABLE "invites" ADD COLUMN "ujiko_rewarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "ujiko_reward" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "legacy_reward" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- 旧制度の支払済みを残す。500枚以上の支払いは両段階のお礼として扱う。
UPDATE "invites" SET "legacy_reward" = true WHERE "rewarded_at" IS NOT NULL;
--> statement-breakpoint
UPDATE "invites" SET "ujiko_rewarded_at" = "rewarded_at", "ujiko_reward" = 0
WHERE "legacy_reward" = true AND "reward" >= 500;
