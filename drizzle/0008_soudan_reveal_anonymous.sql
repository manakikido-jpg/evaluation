-- 相談した人を確認した記録から「相手」を消す（記録は神職も見られるので、匿名が守れなくなるため）
UPDATE "audit_logs" SET "target_id" = NULL WHERE "action" = 'soudan.reveal';
