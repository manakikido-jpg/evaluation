CREATE TABLE "keiba_winning_notices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"table_id" bigint NOT NULL,
	"race_no" integer NOT NULL,
	"member_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"coin_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"message_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "keiba_winning_notice_once" ON "keiba_winning_notices" USING btree ("table_id","race_no","member_id");--> statement-breakpoint
CREATE INDEX "keiba_winning_notice_pending" ON "keiba_winning_notices" USING btree ("status","available_at");