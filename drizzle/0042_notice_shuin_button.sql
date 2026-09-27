ALTER TABLE "notices" ADD COLUMN "shuin_button" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "posted_shuin_button" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- #絵馬-男性・#絵馬-女性 のひな形（いちばん下に表示し続ける「使い方」）にボタンを付ける（反映すると出る）
UPDATE "notices" SET "shuin_button" = true WHERE "sticky" = true AND "title" = '使い方';
