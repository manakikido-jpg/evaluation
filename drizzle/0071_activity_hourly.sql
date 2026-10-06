CREATE TABLE "activity_hourly" (
	"member_id" text NOT NULL,
	"date" text NOT NULL,
	"hour" integer NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"vc_minutes" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_hourly_member_id_date_hour_pk" PRIMARY KEY("member_id","date","hour")
);
--> statement-breakpoint
CREATE INDEX "activity_hourly_date_idx" ON "activity_hourly" USING btree ("date");