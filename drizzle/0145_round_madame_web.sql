CREATE TABLE "keiba_event_entries" (
	"event_id" bigint NOT NULL,
	"horse_id" bigint NOT NULL,
	"owner_id" text NOT NULL,
	"team" text DEFAULT '' NOT NULL,
	CONSTRAINT "keiba_event_entries_event_id_horse_id_pk" PRIMARY KEY("event_id","horse_id")
);
--> statement-breakpoint
CREATE TABLE "keiba_event_rewards" (
	"event_id" bigint NOT NULL,
	"member_id" text NOT NULL,
	"rank" integer NOT NULL,
	"title" text NOT NULL,
	"color" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keiba_event_rewards_event_id_member_id_pk" PRIMARY KEY("event_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "keiba_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"rules" jsonb NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"table_id" bigint,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keiba_replays" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"table_id" bigint NOT NULL,
	"race_key" text NOT NULL,
	"data" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "keiba_horses" ADD COLUMN "development" jsonb DEFAULT '{"points":{},"skills":[],"history":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "keiba_runs" ADD COLUMN "table_id" bigint;--> statement-breakpoint
ALTER TABLE "keiba_event_entries" ADD CONSTRAINT "keiba_event_entries_event_id_keiba_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."keiba_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keiba_event_entries" ADD CONSTRAINT "keiba_event_entries_horse_id_keiba_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."keiba_horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keiba_event_rewards" ADD CONSTRAINT "keiba_event_rewards_event_id_keiba_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."keiba_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "keiba_replays_table_key" ON "keiba_replays" USING btree ("table_id","race_key");