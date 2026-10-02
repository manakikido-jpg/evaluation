CREATE TABLE "mahjong_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"table_id" bigint NOT NULL,
	"member_id" text NOT NULL,
	"name" text NOT NULL,
	"rank" integer NOT NULL,
	"points" integer NOT NULL,
	"length" text NOT NULL,
	"entry" integer DEFAULT 0 NOT NULL,
	"payout" integer DEFAULT 0 NOT NULL,
	"hands" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"tsumo" integer DEFAULT 0 NOT NULL,
	"dealins" integer DEFAULT 0 NOT NULL,
	"riichi" integer DEFAULT 0 NOT NULL,
	"best_points" integer DEFAULT 0 NOT NULL,
	"best_name" text,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mahjong_results_member_idx" ON "mahjong_results" USING btree ("member_id","finished_at");--> statement-breakpoint
CREATE INDEX "mahjong_results_time_idx" ON "mahjong_results" USING btree ("finished_at");