CREATE TABLE "slot_at_machines" (
	"machine" integer PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"seat_by" text,
	"seat_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
