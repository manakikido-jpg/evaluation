CREATE TABLE "sewayaku_elections" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"qualified_at" timestamp with time zone NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"voter_ids" jsonb,
	"votes" integer,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sewayaku_votes" (
	"election_id" bigint NOT NULL,
	"voter_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sewayaku_votes_election_id_voter_id_pk" PRIMARY KEY("election_id","voter_id")
);
--> statement-breakpoint
CREATE INDEX "sewayaku_elections_candidate_idx" ON "sewayaku_elections" USING btree ("candidate_id","ends_at");--> statement-breakpoint
CREATE INDEX "sewayaku_elections_status_idx" ON "sewayaku_elections" USING btree ("status","starts_at");