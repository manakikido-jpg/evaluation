CREATE TABLE "ai_matches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game" text NOT NULL,
	"variant" text DEFAULT '' NOT NULL,
	"ai_version" text DEFAULT '1' NOT NULL,
	"table_id" bigint,
	"players" integer NOT NULL,
	"bots" integer NOT NULL,
	"seats" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_matches_game_idx" ON "ai_matches" USING btree ("game","at");