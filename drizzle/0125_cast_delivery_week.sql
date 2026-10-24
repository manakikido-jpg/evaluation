-- 納品待ちの既存注文も、注文日時から7日後へ延長する。
-- より長い期限、納品済み、返金・完了済み、通話予約は変えない。
UPDATE "cast_sessions"
SET "accept_by" = "created_at" + INTERVAL '168 hours'
WHERE "status" = 'ordered'
  AND "plan" LIKE 'dlv:%'
  AND "accept_by" < "created_at" + INTERVAL '168 hours';
