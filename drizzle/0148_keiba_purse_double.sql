-- 採用した競馬の保証上乗せ条件を、保存済み設定にも一度だけ適用する。
-- 倍率2・本人の正の賭けから対象・他人の賭け不要・日額1000・出走料50。
-- 馬券、財布、馬、過去の払出、ほかのカジノ設定は変更しない。
INSERT INTO "settings" ("key", "value", "updated_by")
VALUES ('overrides', '{"casino":{"keibaBetPurseMult":2,"keibaPurseMinBet":1,"keibaPurseOthersMin":0,"keibaBetDailyCap":1000,"keibaEntryFee":50}}'::jsonb, 'system')
ON CONFLICT ("key") DO UPDATE SET
  "value" = jsonb_set("settings"."value", '{casino}',
    coalesce("settings"."value"->'casino', '{}'::jsonb) || (excluded."value"->'casino'), true),
  "updated_by" = 'system',
  "updated_at" = now();
