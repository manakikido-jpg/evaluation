ALTER TABLE "fortune_rounds" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "fortune_rounds" SET "notified_at" = "settled_at" WHERE "settled_at" IS NOT NULL;
