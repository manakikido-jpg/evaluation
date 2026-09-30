CREATE TABLE "casino_games" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"game" text NOT NULL,
	"bet" integer NOT NULL,
	"state" jsonb NOT NULL,
	"status" text DEFAULT 'playing' NOT NULL,
	"payout" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "casino_matches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game" text DEFAULT 'othello' NOT NULL,
	"host_id" text NOT NULL,
	"guest_id" text,
	"bet" integer NOT NULL,
	"state" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"winner_id" text,
	"end_reason" text,
	"version" integer DEFAULT 0 NOT NULL,
	"turn_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "member_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"csrf_token" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "casino_games_member_idx" ON "casino_games" USING btree ("member_id","status");--> statement-breakpoint
CREATE INDEX "casino_games_created_idx" ON "casino_games" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "casino_matches_status_idx" ON "casino_matches" USING btree ("status");