-- キャストは予約だけになったので、待機（時間で切れる）をやめて「予約受付中 / 受付停止」にする。
-- いま在籍しているキャストは、みんな受付中から始める（今までどおり予約できるように）
UPDATE "casts" SET "available" = 'waiting', "waiting_until" = NULL WHERE "status" = 'active';
