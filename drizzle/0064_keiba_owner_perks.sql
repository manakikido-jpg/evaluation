CREATE TABLE "keiba_owners" (
	"member_id" text PRIMARY KEY NOT NULL,
	"silk" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keiba_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"horse_id" bigint NOT NULL,
	"horse_name" text NOT NULL,
	"owner_id" text NOT NULL,
	"pos" integer NOT NULL,
	"prize" integer DEFAULT 0 NOT NULL,
	"cls" integer NOT NULL,
	"race" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"announced_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "keiba_horses" ADD COLUMN "fatigue" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "keiba_horses" ADD COLUMN "fatigue_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "keiba_horses" ADD COLUMN "train_boost" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "keiba_horses" ADD COLUMN "trained_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "keiba_horses" ADD COLUMN "rest_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "keiba_horses" ADD COLUMN "sale_price" integer;--> statement-breakpoint
ALTER TABLE "keiba_horses" ADD COLUMN "parent_id" bigint;--> statement-breakpoint
ALTER TABLE "keiba_horses" ADD COLUMN "breeding" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "keiba_runs_owner_idx" ON "keiba_runs" USING btree ("owner_id","at");--> statement-breakpoint
CREATE INDEX "keiba_runs_time_idx" ON "keiba_runs" USING btree ("at");