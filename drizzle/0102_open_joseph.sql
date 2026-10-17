ALTER TABLE "presence_gifts" ADD COLUMN "member_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "presence_gifts" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "presence_gifts" ADD COLUMN "revoked_by" text;