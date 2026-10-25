ALTER TABLE "visit_profiles" ALTER COLUMN "public_stats" SET DEFAULT true;
--> statement-breakpoint
-- 運営の指定により、既存プロフィールもこの移行時に一度だけ公開へ切り替える。
-- この後に本人が選び直した非公開設定はアプリの読み込みで変更しない。
UPDATE "visit_profiles" SET "public_stats" = true WHERE "public_stats" = false;
