ALTER TABLE "keiba_horses" ADD COLUMN "dam_id" bigint;--> statement-breakpoint
ALTER TABLE "keiba_horses" ADD COLUMN "stud_fee" integer DEFAULT 0 NOT NULL;