CREATE TABLE "activity_daily" (
	"member_id" text NOT NULL,
	"date" text NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"vc_minutes" integer DEFAULT 0 NOT NULL,
	"vc_coins" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_daily_member_id_date_pk" PRIMARY KEY("member_id","date")
);
--> statement-breakpoint
CREATE TABLE "coin_tx" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"body" text NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"member_id" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"lifetime_earned" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_balance_nonneg" CHECK ("wallets"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "yaku" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"kind" text DEFAULT 'normal' NOT NULL,
	"reason" text NOT NULL,
	"issued_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_by" text,
	"cleared_reason" text,
	"cleared_note" text
);
--> statement-breakpoint
CREATE INDEX "coin_tx_member_idx" ON "coin_tx" USING btree ("member_id","at");--> statement-breakpoint
CREATE INDEX "memos_member_idx" ON "memos" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "yaku_member_idx" ON "yaku" USING btree ("member_id","created_at");