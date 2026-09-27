CREATE TABLE "custom_ticket_holdings" (
	"member_id" text NOT NULL,
	"ticket_id" bigint NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "custom_ticket_holdings_member_id_ticket_id_pk" PRIMARY KEY("member_id","ticket_id")
);
--> statement-breakpoint
CREATE TABLE "custom_tickets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"emoji" text DEFAULT '🎟' NOT NULL,
	"name" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gacha_draws" ADD COLUMN "custom_ticket_id" bigint;--> statement-breakpoint
ALTER TABLE "gacha_prizes" ADD COLUMN "custom_ticket_id" bigint;