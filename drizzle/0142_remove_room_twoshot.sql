-- 廃止した部屋は招待制として引き継ぐ。Discord の人数上限・許可者・支払い済み額は変えない。
UPDATE temp_voice SET kind = 'invite' WHERE kind = 'twoshot';
--> statement-breakpoint
INSERT INTO tickets (member_id, kind, count, updated_at)
SELECT member_id, replace(kind, '_twoshot', '_invite'), count, updated_at
FROM tickets WHERE kind IN ('room_free_twoshot', 'room_half_twoshot', 'room_day_twoshot')
ON CONFLICT (member_id, kind) DO UPDATE SET count = tickets.count + EXCLUDED.count, updated_at = greatest(tickets.updated_at, EXCLUDED.updated_at);
--> statement-breakpoint
DELETE FROM tickets WHERE kind IN ('room_free_twoshot', 'room_half_twoshot', 'room_day_twoshot');
--> statement-breakpoint
INSERT INTO room_passes (member_id, kind, until)
SELECT member_id, 'invite', until FROM room_passes WHERE kind = 'twoshot'
ON CONFLICT (member_id, kind) DO UPDATE SET until = greatest(room_passes.until, EXCLUDED.until);
--> statement-breakpoint
DELETE FROM room_passes WHERE kind = 'twoshot';
--> statement-breakpoint
UPDATE gacha_prizes SET ticket = replace(ticket, '_twoshot', '_invite') WHERE ticket IN ('room_free_twoshot', 'room_half_twoshot', 'room_day_twoshot');
--> statement-breakpoint
UPDATE gacha_draws SET ticket = replace(ticket, '_twoshot', '_invite') WHERE ticket IN ('room_free_twoshot', 'room_half_twoshot', 'room_day_twoshot');
--> statement-breakpoint
UPDATE shop_purchases SET ticket = replace(ticket, '_twoshot', '_invite') WHERE ticket IN ('room_free_twoshot', 'room_half_twoshot', 'room_day_twoshot');
--> statement-breakpoint
UPDATE economy_events SET ticket = replace(ticket, '_twoshot', '_invite') WHERE ticket IN ('room_free_twoshot', 'room_half_twoshot', 'room_day_twoshot');
--> statement-breakpoint
UPDATE presence_gifts SET ticket_kind = replace(ticket_kind, '_twoshot', '_invite') WHERE ticket_kind IN ('room_free_twoshot', 'room_half_twoshot', 'room_day_twoshot');
--> statement-breakpoint
-- JSON の値だけを変換し、キャスト/市場の通話種別 twoshot や文章はそのまま残す。
CREATE OR REPLACE FUNCTION pg_temp.migrate_room_ticket(v jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
  CASE jsonb_typeof(v)
    WHEN 'object' THEN
      SELECT coalesce(jsonb_object_agg(key, pg_temp.migrate_room_ticket(value)), '{}'::jsonb) INTO result FROM jsonb_each(v);
    WHEN 'array' THEN
      SELECT coalesce(jsonb_agg(pg_temp.migrate_room_ticket(value) ORDER BY ord), '[]'::jsonb) INTO result FROM jsonb_array_elements(v) WITH ORDINALITY AS x(value, ord);
    WHEN 'string' THEN
      result := CASE v #>> '{}'
        WHEN 'room_free_twoshot' THEN '"room_free_invite"'::jsonb
        WHEN 'room_half_twoshot' THEN '"room_half_invite"'::jsonb
        WHEN 'room_day_twoshot' THEN '"room_day_invite"'::jsonb
        ELSE v END;
    ELSE result := v;
  END CASE;
  RETURN result;
END; $$;
--> statement-breakpoint
UPDATE settings SET value = pg_temp.migrate_room_ticket(value)
WHERE value::text LIKE '%room\_%\_twoshot%' ESCAPE '\';
--> statement-breakpoint
UPDATE settings SET value = value #- '{rooms,once,twoshot}' #- '{rooms,hourly,twoshot}' WHERE key = 'overrides';
