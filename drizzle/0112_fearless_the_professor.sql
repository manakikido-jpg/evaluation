CREATE TABLE "boost_time_attendance" (
	"boost_id" bigint NOT NULL,
	"member_id" text NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	CONSTRAINT "boost_time_attendance_boost_id_member_id_pk" PRIMARY KEY("boost_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "boost_times" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"min_minutes" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"canceled_at" timestamp with time zone,
	"gifted_at" timestamp with time zone,
	CONSTRAINT "boost_times_range" CHECK ("boost_times"."end_at" > "boost_times"."start_at")
);
--> statement-breakpoint
ALTER TABLE "boost_time_attendance" ADD CONSTRAINT "boost_time_attendance_boost_id_boost_times_id_fk" FOREIGN KEY ("boost_id") REFERENCES "public"."boost_times"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boost_times_end_idx" ON "boost_times" USING btree ("end_at");