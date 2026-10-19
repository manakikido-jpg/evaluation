CREATE TABLE "fortune_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"draw_at" timestamp with time zone NOT NULL,
	"price" integer NOT NULL,
	"per_member" integer NOT NULL,
	"return_pct" integer NOT NULL,
	"bonus" integer NOT NULL,
	"sold" integer DEFAULT 0 NOT NULL,
	"settled_at" timestamp with time zone,
	"winner_id" text,
	"winning_number" integer,
	"payout" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fortune_scratch" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"day" text NOT NULL,
	"price" integer NOT NULL,
	"payout" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fortune_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"member_id" text NOT NULL,
	"number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fortune_tickets" ADD CONSTRAINT "fortune_tickets_round_id_fortune_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."fortune_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fortune_rounds_due" ON "fortune_rounds" USING btree ("draw_at","settled_at");--> statement-breakpoint
CREATE INDEX "fortune_scratch_member_day" ON "fortune_scratch" USING btree ("member_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "fortune_ticket_number" ON "fortune_tickets" USING btree ("round_id","number");--> statement-breakpoint
CREATE INDEX "fortune_ticket_member" ON "fortune_tickets" USING btree ("round_id","member_id");