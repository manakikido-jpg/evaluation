CREATE TABLE "bingo_cards" (
	"event_id" text NOT NULL,
	"member_id" text NOT NULL,
	"name" text NOT NULL,
	"numbers" jsonb NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "bingo_cards_event_id_member_id_pk" PRIMARY KEY("event_id","member_id"),
	CONSTRAINT "bingo_card_size" CHECK (jsonb_array_length("bingo_cards"."numbers") = 25)
);
--> statement-breakpoint
CREATE TABLE "bingo_events" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"host_id" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"draws" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_number" integer,
	"reveal_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"summary" jsonb DEFAULT '{"participants":0,"reaches":0,"winners":[]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "bingo_status_valid" CHECK ("bingo_events"."status" in ('waiting','active','closed')),
	CONSTRAINT "bingo_draw_count" CHECK (jsonb_array_length("bingo_events"."draws") <= 75),
	CONSTRAINT "bingo_pending_valid" CHECK ("bingo_events"."pending_number" is null or "bingo_events"."pending_number" between 1 and 75),
	CONSTRAINT "bingo_pending_pair" CHECK (("bingo_events"."pending_number" is null) = ("bingo_events"."reveal_at" is null))
);
--> statement-breakpoint
ALTER TABLE "bingo_cards" ADD CONSTRAINT "bingo_cards_event_id_bingo_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."bingo_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bingo_one_live" ON "bingo_events" USING btree ((true)) WHERE "bingo_events"."status" <> 'closed';