CREATE TABLE "casino_arcade_requests" (
	"member_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"game_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "casino_arcade_requests_member_id_operation_id_pk" PRIMARY KEY("member_id","operation_id")
);
--> statement-breakpoint
ALTER TABLE "casino_arcade_requests" ADD CONSTRAINT "casino_arcade_requests_game_id_casino_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."casino_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "casino_arcade_requests_game_idx" ON "casino_arcade_requests" USING btree ("game_id");