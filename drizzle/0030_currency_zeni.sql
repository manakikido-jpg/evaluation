-- 通貨を「銭」に統一する（名前が花びらのとき・まだ決めていないときだけ。ほかの名前にしていれば変えない）
-- 投稿済みの掲示を新しい名前で出し直すための印（BOT が起動したときに 1 回だけ使って消す）
INSERT INTO "settings" ("key", "value", "updated_by")
SELECT 'currency_rename_sync', jsonb_build_object('name', '花びら', 'emoji', coalesce("value"->'economy'->>'currencyEmoji', '🌸')), 'system'
FROM "settings"
WHERE "key" = 'overrides' AND coalesce("value"->'economy'->>'currencyName', '花びら') = '花びら'
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "settings" ("key", "value", "updated_by")
SELECT 'currency_rename_sync', '{"name":"花びら","emoji":"🌸"}'::jsonb, 'system'
WHERE NOT EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'overrides')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
UPDATE "settings"
SET "value" = jsonb_set(
  "value",
  '{economy}',
  coalesce("value"->'economy', '{}'::jsonb)
    || '{"currencyName":"銭"}'::jsonb
    || CASE WHEN coalesce("value"->'economy'->>'currencyEmoji', '🌸') = '🌸' THEN '{"currencyEmoji":"🪙"}'::jsonb ELSE '{}'::jsonb END,
  true
)
WHERE "key" = 'overrides' AND coalesce("value"->'economy'->>'currencyName', '花びら') = '花びら';
--> statement-breakpoint
-- 管理画面でまだ何も保存していないとき（config/guild.json が花びらのままでも銭にする）
INSERT INTO "settings" ("key", "value", "updated_by")
VALUES ('overrides', '{"economy":{"currencyName":"銭","currencyEmoji":"🪙"}}'::jsonb, 'system')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- ショップの品の名前・説明
UPDATE "shop_items"
SET "name" = replace("name", '花びら', '銭'), "description" = replace("description", '花びら', '銭')
WHERE "name" LIKE '%花びら%' OR "description" LIKE '%花びら%';
--> statement-breakpoint
-- 掲示の本文に直接書いた「花びら」は {通貨} に（{おみくじの花びら} はそのまま）
UPDATE "notices"
SET "body" = replace(replace(replace("body", '{おみくじの花びら}', '{@@omikuji@@}'), '花びら', '{通貨}'), '{@@omikuji@@}', '{おみくじの花びら}')
WHERE replace("body", '{おみくじの花びら}', '') LIKE '%花びら%';
