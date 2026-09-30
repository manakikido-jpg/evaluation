CREATE TABLE "event_ticket_grants" (
	"event_id" bigint NOT NULL,
	"member_id" text NOT NULL,
	"date" text NOT NULL,
	"minutes" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_ticket_grants_event_id_member_id_date_pk" PRIMARY KEY("event_id","member_id","date")
);
--> statement-breakpoint
ALTER TABLE "economy_events" ADD COLUMN "ticket" text DEFAULT 'gacha_free' NOT NULL;--> statement-breakpoint
ALTER TABLE "economy_events" ADD COLUMN "ticket_count" integer DEFAULT 1 NOT NULL;