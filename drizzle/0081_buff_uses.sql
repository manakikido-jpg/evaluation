ALTER TABLE "member_buffs" ADD COLUMN "day" text;--> statement-breakpoint
ALTER TABLE "member_buffs" ADD COLUMN "uses" integer DEFAULT 0 NOT NULL;