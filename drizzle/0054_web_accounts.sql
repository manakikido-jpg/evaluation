CREATE TABLE "web_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"login_id" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"level" text NOT NULL,
	"pages" text[],
	"member_id" text,
	"disabled" boolean DEFAULT false NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_accounts_login_id_unique" UNIQUE("login_id")
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD COLUMN "account_id" bigint;--> statement-breakpoint
-- ID とパスワードのログインに切り替えた: 今ログインしている人は全員ログアウトさせる
DELETE FROM "admin_sessions";
