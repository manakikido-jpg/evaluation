CREATE TABLE "event_lotteries" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"fee" integer NOT NULL,
	"channel_id" text NOT NULL,
	"result_channel_id" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"prizes" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_fee_positive" CHECK ("event_lotteries"."fee">0)
);
--> statement-breakpoint
CREATE TABLE "event_lottery_draws" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"member_id" text NOT NULL,
	"display_name" text NOT NULL,
	"prize_id" text NOT NULL,
	"prize_name" text NOT NULL,
	"coins" integer NOT NULL,
	"item" text NOT NULL,
	"delivered" boolean DEFAULT false NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_lottery_entries" (
	"event_id" text NOT NULL,
	"member_id" text NOT NULL,
	"display_name" text NOT NULL,
	"paid" integer NOT NULL,
	"refunded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_lottery_entries_event_id_member_id_pk" PRIMARY KEY("event_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "event_lottery_notices" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "event_lottery_draws" ADD CONSTRAINT "event_lottery_draws_event_id_event_lotteries_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_lotteries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_lottery_entries" ADD CONSTRAINT "event_lottery_entries_event_id_event_lotteries_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_lotteries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_lottery_notices" ADD CONSTRAINT "event_lottery_notices_event_id_event_lotteries_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_lotteries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_winner_once" ON "event_lottery_draws" USING btree ("event_id","member_id");