CREATE TABLE "core_time_attendance" (
	"day" text NOT NULL,
	"slot" text NOT NULL,
	"member_id" text NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	CONSTRAINT "core_time_attendance_day_slot_member_id_pk" PRIMARY KEY("day","slot","member_id")
);
--> statement-breakpoint
CREATE INDEX "core_time_attendance_member_idx" ON "core_time_attendance" USING btree ("member_id","day");