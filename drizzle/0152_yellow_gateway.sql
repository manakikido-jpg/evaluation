CREATE TABLE "office_app" (
	"id" integer PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"icon" text,
	"icon_version" text DEFAULT 'default' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" bigint,
	"session_id" text NOT NULL,
	"subscription" jsonb NOT NULL,
	"topics" text[] NOT NULL,
	"last_keys" text[] DEFAULT '{}' NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD COLUMN "write_pages" text[];--> statement-breakpoint
ALTER TABLE "web_accounts" ADD COLUMN "write_pages" text[];--> statement-breakpoint
CREATE INDEX "office_subscriptions_owner_idx" ON "office_subscriptions" USING btree ("user_id");