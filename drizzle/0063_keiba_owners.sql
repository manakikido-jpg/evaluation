ALTER TABLE "keiba_horses" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "keiba_horses" ADD COLUMN "prize" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "keiba_horses" ADD COLUMN "sex" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "keiba_horses" ADD COLUMN "age" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "keiba_horses" ADD COLUMN "weight" integer DEFAULT 480 NOT NULL;