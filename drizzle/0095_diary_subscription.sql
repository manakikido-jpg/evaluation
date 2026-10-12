ALTER TABLE "diaries" ADD COLUMN "paid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "diaries" ADD COLUMN "auto_renew" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "diaries" ADD COLUMN "reminded_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "diaries" ADD COLUMN "locked_at" timestamp with time zone;