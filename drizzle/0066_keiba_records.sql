CREATE TABLE "keiba_bets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"race" text NOT NULL,
	"cls" integer DEFAULT 0 NOT NULL,
	"type" text NOT NULL,
	"key" text NOT NULL,
	"names" text DEFAULT '' NOT NULL,
	"amount" integer NOT NULL,
	"odds" integer DEFAULT 0 NOT NULL,
	"payout" integer DEFAULT 0 NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keiba_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"horse_id" bigint NOT NULL,
	"horse_name" text NOT NULL,
	"owner_id" text,
	"race" text NOT NULL,
	"cls" integer NOT NULL,
	"dist" integer NOT NULL,
	"surface" integer NOT NULL,
	"going" integer DEFAULT 0 NOT NULL,
	"field" integer NOT NULL,
	"no" integer NOT NULL,
	"pop" integer NOT NULL,
	"odds" integer NOT NULL,
	"pos" integer NOT NULL,
	"time" text NOT NULL,
	"margin" text DEFAULT '' NOT NULL,
	"last3f" integer DEFAULT 0 NOT NULL,
	"corners" text DEFAULT '' NOT NULL,
	"prize" integer DEFAULT 0 NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "keiba_bets_member_idx" ON "keiba_bets" USING btree ("member_id","at");--> statement-breakpoint
CREATE INDEX "keiba_entries_horse_idx" ON "keiba_entries" USING btree ("horse_id","at");